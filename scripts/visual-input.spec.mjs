//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

// @vitest-environment node

import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'vite';

import { toDataTable } from '../src/lib/to-data-table.ts';
import {
    assertResultFile,
    buildQueryCliArgs,
    createVisualInputLoader,
    findFactoryExport,
    parseInvokeEnvelope,
    parseQueryResult,
    parseValidationRequests,
} from './visual-input.mjs';

const { execFileAsync } = vi.hoisted(() => ({ execFileAsync: vi.fn() }));
vi.mock('node:child_process', async () => {
    const { promisify } = await import('node:util');
    return { execFile: Object.assign(vi.fn(), { [promisify.custom]: execFileAsync }) };
});
vi.mock('vite', () => ({ createServer: vi.fn() }));

const queryTable = {
    columns: [{ name: '[Value]', dataType: 'number' }],
    rows: [[1]],
};
const queryResult = { status: 'success', table: queryTable, requestId: 'request-1' };
const successEnvelope = {
    status: 'ok',
    connector: 'sales',
    operation: 'executeQuery',
    output: queryResult,
};
const definition = {
    connection: 'sales',
    query: 'EVALUATE ROW("Value", 1)',
    columnMetadata: { '[Value]': { name: 'value', displayName: 'Value', format: '0' } },
    vegaLiteSpec: { mark: 'bar', encoding: { x: { field: 'value', type: 'quantitative' } } },
};

/**
 * Stands in for the CLI: writes the full result to --output-file and prints the envelope,
 * which reports the absolute path it wrote.
 */
function mockInvoke(result = queryResult, envelope = successEnvelope) {
    execFileAsync.mockImplementation(async (_command, args, options) => {
        const outputFile = resolve(options?.cwd ?? process.cwd(), args[args.indexOf('--output-file') + 1]);
        await writeFile(outputFile, JSON.stringify(result), 'utf8');
        return { stdout: JSON.stringify({ outputFile, ...envelope }) };
    });
}

beforeEach(() => {
    vi.resetAllMocks();
    mockInvoke();
});

describe('visual input', () => {
    it('invokes the semantic-model connector through the Rayfin CLI with payload and result files', () => {
        expect(buildQueryCliArgs('cli-entry.js', 'sales', '/tmp/q.json', '/tmp/r.json')).toEqual([
            'cli-entry.js', 'connector', 'invoke',
            '--name', 'sales', '--operation', 'executeQuery',
            '--file', '/tmp/q.json', '--output-file', '/tmp/r.json', '--json',
        ]);
    });

    it('parses multiple factories and JSON-object parameter variants', () => {
        expect(parseValidationRequests([
            'src/queries/sales/revenue.ts',
            'src/queries/sales/trend.ts', '{"granularity":"monthly"}',
            'src/queries/sales/trend.ts', '{"granularity":"yearly"}',
        ])).toEqual([
            { factoryPath: 'src/queries/sales/revenue.ts', params: undefined },
            { factoryPath: 'src/queries/sales/trend.ts', params: { granularity: 'monthly' } },
            { factoryPath: 'src/queries/sales/trend.ts', params: { granularity: 'yearly' } },
        ]);
        expect(() => parseValidationRequests([])).toThrow('Usage: npm run validate:visual -- ');
        expect(() => parseValidationRequests(['query.json'])).toThrow('Expected a query-factory .ts path');
        for (const params of ['not-json', 'null', '[]', '1', '"text"']) {
            expect(() => parseValidationRequests(['revenue.ts', params]))
                .toThrow('Invalid parameters for revenue.ts');
        }
    });

    it('uses the first exported function and explains missing factories', () => {
        const firstFactory = () => ({});
        expect(findFactoryExport({
            metadata: {},
            arbitraryName: firstFactory,
            anotherFunction: () => ({}),
        }, 'different-file-name.ts')).toEqual({ factoryName: 'arbitraryName', factory: firstFactory });
        expect(() => findFactoryExport({ metadata: {} }, 'different-file-name.ts'))
            .toThrow('Available exports: metadata.');
    });

    it('accepts a successful envelope and rejects failed or malformed ones', () => {
        expect(parseInvokeEnvelope(JSON.stringify(successEnvelope))).toEqual(successEnvelope);
        // The CLI may print progress before its envelope; only the final JSON line is the result.
        expect(parseInvokeEnvelope(`Invoking sales.executeQuery\n${JSON.stringify(successEnvelope)}\n`))
            .toEqual(successEnvelope);
        // A CLI-level failure and a connector result that declares its own failure both have to be rejected.
        for (const failure of [
            { status: 'error', error: 'Bad DAX' },
            { ...successEnvelope, output: { status: 'error', error: { message: 'Bad DAX' } } },
            { ...successEnvelope, output: { status: 'error', error: 'Bad DAX' } },
        ]) {
            expect(() => parseInvokeEnvelope(JSON.stringify(failure)))
                .toThrow('Rayfin connector invoke failed: Bad DAX');
        }
        expect(() => parseInvokeEnvelope('not-json')).toThrow('did not return valid JSON');
        expect(() => parseInvokeEnvelope('')).toThrow('did not return valid JSON');
        for (const envelope of [null, {}, { status: 'success', table: queryTable }]) {
            expect(() => parseInvokeEnvelope(JSON.stringify(envelope))).toThrow('unexpected result shape');
        }
    });

    it('keeps the CLI recovery hint, which is often the only actionable part of a failure', () => {
        // Shape of the CLI's --json failure when Power BI consent needs an interactive prompt.
        const consentFailure = {
            status: 'error',
            error: 'Not signed in, or no Power BI token could be acquired without an interactive prompt.',
            recovery: 'Re-run without `--json` to complete Power BI consent interactively, then retry.',
        };
        expect(() => parseInvokeEnvelope(JSON.stringify(consentFailure))).toThrow(
            'Rayfin connector invoke failed: Not signed in, or no Power BI token could be acquired '
            + 'without an interactive prompt. Re-run without `--json` to complete Power BI consent '
            + 'interactively, then retry.',
        );
        // A blank recovery adds nothing, and the message stays exactly as before.
        expect(() => parseInvokeEnvelope(JSON.stringify({ status: 'error', error: 'Bad DAX', recovery: ' ' })))
            .toThrow(/^Rayfin connector invoke failed: Bad DAX$/);
    });

    it('requires the envelope to point at the requested result file', () => {
        const resultPath = resolve('.lyra-rayfin-test', 'visual.result.json');
        expect(() => assertResultFile({ ...successEnvelope, outputFile: resultPath }, resultPath)).not.toThrow();
        expect(() => assertResultFile({ ...successEnvelope, outputFile: resultPath, outputTruncated: true }, resultPath))
            .not.toThrow();
        expect(() => assertResultFile(successEnvelope, resultPath)).toThrow('Upgrade @microsoft/rayfin-cli');
        expect(() => assertResultFile({ ...successEnvelope, outputTruncated: true }, resultPath))
            .toThrow('truncated preview without a result file');
        expect(() => assertResultFile({ ...successEnvelope, outputFile: resolve('other.json') }, resultPath))
            .toThrow('instead of the requested --output-file');
    });

    it('parses the result file and rejects empty or malformed results', () => {
        expect(parseQueryResult(JSON.stringify(queryResult))).toEqual(queryTable);
        expect(() => parseQueryResult(JSON.stringify({
            ...queryResult, table: { columns: [], rows: [] },
        }))).toThrow('returned no rows');
        expect(() => parseQueryResult('not-json')).toThrow('did not contain valid JSON');
        for (const result of [
            null,
            {},
            { status: 'success', table: { rows: [[1]] } },
            { status: 'success', table: { columns: [] } },
            // The envelope belongs on stdout; the result file holds the result itself.
            successEnvelope,
        ]) {
            expect(() => parseQueryResult(JSON.stringify(result))).toThrow('unexpected result shape');
        }
    });
});

describe('visual input loader', () => {
    function mockServer(factoryModule = { makeVisual: vi.fn().mockResolvedValue(definition) }) {
        const server = {
            ssrLoadModule: vi.fn(async (path) => path === '/src/lib/to-data-table.ts'
                ? { toDataTable }
                : factoryModule),
            close: vi.fn().mockResolvedValue(),
        };
        vi.mocked(createServer).mockResolvedValue(server);
        return server;
    }

    it('loads raw DAX and JSON imports through one Vite server and prepares complete data', async () => {
        const projectRoot = await mkdtemp(resolve(tmpdir(), 'visual-input-'));
        const vite = await vi.importActual('vite');
        let loader;
        let server;
        try {
            await mkdir(resolve(projectRoot, 'src/queries'), { recursive: true });
            await mkdir(resolve(projectRoot, 'src/lib'), { recursive: true });
            await copyFile(new URL('../src/lib/to-data-table.ts', import.meta.url), resolve(projectRoot, 'src/lib/to-data-table.ts'));
            await writeFile(resolve(projectRoot, 'src/queries/revenue.dax'), definition.query);
            await writeFile(resolve(projectRoot, 'src/queries/revenue.json'), JSON.stringify(definition.vegaLiteSpec));
            await writeFile(resolve(projectRoot, 'src/queries/revenue.ts'), `
                import query from './revenue.dax?raw';
                import vegaLiteSpec from './revenue.json';
                export async function makeVisual(params: { period?: string } | undefined) {
                    return {
                        connection: params?.period ?? 'sales', query, vegaLiteSpec,
                        columnMetadata: ${JSON.stringify(definition.columnMetadata)},
                    };
                }
            `);
            vi.mocked(createServer).mockImplementationOnce(async (options) => {
                server = await vite.createServer({
                    ...options,
                    configFile: false,
                    server: { ...options.server, hmr: false, watch: null },
                });
                vi.spyOn(server, 'close');
                return server;
            });
            loader = await createVisualInputLoader(projectRoot);
            let payloadContents;
            let payloadDirectoryExisted;
            execFileAsync.mockImplementation(async (_command, args) => {
                // Read the payload while it exists: the loader deletes it once the query returns.
                const payloadPath = args[args.indexOf('--file') + 1];
                payloadContents = await readFile(payloadPath, 'utf8');
                payloadDirectoryExisted = existsSync(dirname(payloadPath));
                const outputFile = args[args.indexOf('--output-file') + 1];
                await writeFile(outputFile, JSON.stringify(queryResult), 'utf8');
                return { stdout: JSON.stringify({ ...successEnvelope, outputFile }) };
            });
            for (const params of [undefined, { period: 'monthly' }]) {
                const result = await loader.load({ factoryPath: 'src/queries/revenue.ts', params });
                expect(result).toEqual({
                    factoryName: 'makeVisual',
                    definition: { ...definition, connection: params?.period ?? 'sales' },
                    queryTable,
                    dataTable: { columns: [definition.columnMetadata['[Value]']], rows: queryTable.rows },
                });
            }
            expect(createServer).toHaveBeenCalledExactlyOnceWith({
                root: projectRoot, appType: 'custom', logLevel: 'error', server: { middlewareMode: true },
            });
            const packageJson = fileURLToPath(import.meta.resolve('@microsoft/rayfin-cli/package.json'));
            const cliEntry = resolve(dirname(packageJson), 'scripts', 'main');
            const [command, args, options] = execFileAsync.mock.lastCall;
            const payloadPath = args[args.indexOf('--file') + 1];
            const resultPath = args[args.indexOf('--output-file') + 1];
            expect(payloadPath).toMatch(/visual\.query\.json$/);
            expect(resultPath).toMatch(/visual\.result\.json$/);
            // The Rayfin CLI rejects --file paths outside the project, so the payload
            // (and its result) live in a git-ignored directory inside the app and are removed afterwards.
            for (const path of [payloadPath, resultPath]) {
                expect(dirname(dirname(path))).toBe(projectRoot);
                expect(basename(dirname(path))).toMatch(/^\.lyra-rayfin-/);
            }
            expect(payloadDirectoryExisted).toBe(true);
            expect(existsSync(dirname(payloadPath))).toBe(false);
            expect(command).toBe(process.execPath);
            expect(args).toEqual(buildQueryCliArgs(cliEntry, 'monthly', payloadPath, resultPath));
            expect(options).toEqual(
                { cwd: projectRoot, maxBuffer: 20 * 1024 * 1024, timeout: 120_000, windowsHide: true },
            );
            // DAX comes from model-derived text, so it travels in the payload file, never in argv.
            // The payload also caps the result at 1000 rows, which the connector truncates to silently.
            expect(JSON.parse(payloadContents)).toEqual({ query: definition.query, resultSetRowCountLimit: 1000 });
            expect(args).not.toContain(definition.query);
            expect(server.close).not.toHaveBeenCalled();
        } finally {
            await loader?.close();
            await rm(projectRoot, { recursive: true, force: true });
        }
        expect(server.close).toHaveBeenCalledOnce();
    }, 30_000);

    it('renders the full result file even when the CLI inlines a truncated preview', async () => {
        mockServer();
        const loader = await createVisualInputLoader();
        try {
            const fullTable = {
                columns: queryTable.columns,
                rows: [[1], [2], [3]],
            };
            // The CLI shrinks a large inline payload to a preview; the file stays whole,
            // and a visual validated against the preview would be validated against the wrong data.
            mockInvoke({ ...queryResult, table: fullTable }, {
                ...successEnvelope,
                output: { ...queryResult, table: { columns: queryTable.columns, rows: [[1]] } },
                outputTruncated: true,
                previewItems: 1,
            });
            const { queryTable: loaded, dataTable } = await loader.load({ factoryPath: 'revenue.ts' });
            expect(loaded).toEqual(fullTable);
            expect(dataTable.rows).toEqual([[1], [2], [3]]);
        } finally {
            await loader.close();
        }
    });

    it('rejects a successful invoke that produced no result file', async () => {
        mockServer();
        const loader = await createVisualInputLoader();
        try {
            // The CLI reports the requested path but nothing was written there.
            execFileAsync.mockImplementation(async (_command, args) => ({
                stdout: JSON.stringify({ ...successEnvelope, outputFile: args[args.indexOf('--output-file') + 1] }),
            }));
            await expect(loader.load({ factoryPath: 'revenue.ts' }))
                .rejects.toThrow('did not write a result file');
        } finally {
            await loader.close();
        }
    });

    it('never accepts an inline preview in place of the requested result file', async () => {
        mockServer();
        const loader = await createVisualInputLoader();
        try {
            const failures = [
                // A CLI that ignores --output-file and prints only the inline result.
                [successEnvelope, 'did not report the requested --output-file'],
                [{ ...successEnvelope, outputTruncated: true }, 'truncated preview without a result file'],
                // An automatic spill under rayfin/.temp is not the file the loader asked for.
                [
                    { ...successEnvelope, outputFile: resolve('rayfin/.temp/invoke-results/spilled.json'), outputTruncated: true },
                    'instead of the requested --output-file',
                ],
            ];
            for (const [envelope, message] of failures) {
                execFileAsync.mockImplementationOnce(async (_command, args) => {
                    await writeFile(args[args.indexOf('--output-file') + 1], JSON.stringify(queryResult), 'utf8');
                    return { stdout: JSON.stringify(envelope) };
                });
                await expect(loader.load({ factoryPath: 'revenue.ts' })).rejects.toThrow(message);
            }
        } finally {
            await loader.close();
        }
    });

    it('rejects paths outside the app and invalid definitions without executing a query', async () => {
        const server = mockServer({ makeVisual: () => ({ query: 'incomplete' }) });
        const projectRoot = resolve('test-app');
        const loader = await createVisualInputLoader(projectRoot);
        try {
            for (const factoryPath of ['../outside.ts', resolve(projectRoot, '../outside.ts')]) {
                await expect(loader.load({ factoryPath })).rejects.toThrow('Factory must be inside the app directory');
            }
            expect(server.ssrLoadModule).toHaveBeenCalledTimes(1);
            await expect(loader.load({ factoryPath: 'src/queries/broken.ts' }))
                .rejects.toThrow('must return { connection, query, columnMetadata, vegaLiteSpec }');
            expect(execFileAsync).not.toHaveBeenCalled();
        } finally {
            await loader.close();
        }
        expect(server.close).toHaveBeenCalledOnce();
    });

    it('preserves query errors and remains usable and closable after load failures', async () => {
        const server = mockServer();
        const loader = await createVisualInputLoader();
        try {
            const failures = [
                [new Error('spawn failed'), 'spawn failed'],
                [
                    Object.assign(new Error(), {
                        stdout: '{"status":"error","error":"Bad DAX"}',
                    }),
                    'Rayfin connector invoke failed: Bad DAX',
                ],
                [
                    // A failed CLI process whose --json envelope carries the fix in `recovery`.
                    Object.assign(new Error('Command failed'), {
                        stdout: JSON.stringify({
                            status: 'error',
                            error: 'Not signed in.',
                            recovery: 'Run `npx rayfin login`, then retry.',
                        }),
                    }),
                    'Rayfin connector invoke failed: Not signed in. Run `npx rayfin login`, then retry.',
                ],
                [Object.assign(new Error(), { killed: true }), 'timed out after 120 seconds'],
            ];
            for (const [error, message] of failures) {
                execFileAsync.mockRejectedValueOnce(error);
                await expect(loader.load({ factoryPath: 'revenue.ts' })).rejects.toThrow(message);
            }
            await expect(loader.load({ factoryPath: 'revenue.ts' })).resolves.toMatchObject({ queryTable });
            expect(server.close).not.toHaveBeenCalled();
        } finally {
            await loader.close();
        }
        expect(server.close).toHaveBeenCalledOnce();
    });

    it('closes the server when loading or validating the app-local converter fails', async () => {
        for (const failure of [new Error('Module load failed'), {}]) {
            const server = mockServer();
            if (failure instanceof Error) {
                server.ssrLoadModule.mockRejectedValueOnce(failure);
            } else {
                server.ssrLoadModule.mockResolvedValueOnce(failure);
            }
            await expect(createVisualInputLoader()).rejects.toThrow(
                failure instanceof Error ? failure.message : 'Expected src/lib/to-data-table.ts to export toDataTable().',
            );
            expect(server.close).toHaveBeenCalledOnce();
        }
    });
});
