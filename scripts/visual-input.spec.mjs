//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

// @vitest-environment node

import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'vite';

import { toDataTable } from '../src/lib/to-data-table.ts';
import {
    buildQueryCliArgs,
    createVisualInputLoader,
    findFactoryExport,
    parseQueryOutput,
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
const definition = {
    connection: 'sales',
    query: 'EVALUATE ROW("Value", 1)',
    columnMetadata: { '[Value]': { name: 'value', displayName: 'Value', format: '0' } },
    vegaLiteSpec: { mark: 'bar', encoding: { x: { field: 'value', type: 'quantitative' } } },
};

beforeEach(() => {
    vi.resetAllMocks();
    execFileAsync.mockResolvedValue({ stdout: JSON.stringify({ status: 'success', table: queryTable }) });
});

describe('visual input', () => {
    it('passes an explicit semantic-model source type to the data CLI', () => {
        expect(buildQueryCliArgs('cli-entry.js', 'semanticModel', definition.query)).toEqual([
            'cli-entry.js', 'query', 'semanticModel', 'semanticModel',
            '--query', definition.query, '--limit', '1000',
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

    it('parses query tables and rejects failed, empty, or malformed output', () => {
        expect(parseQueryOutput(JSON.stringify({ status: 'success', table: queryTable }))).toEqual(queryTable);
        for (const error of ['Bad DAX', { message: 'Bad DAX' }]) {
            expect(() => parseQueryOutput(JSON.stringify({ status: 'error', error })))
                .toThrow('Fabric data CLI query failed: Bad DAX');
        }
        expect(() => parseQueryOutput(JSON.stringify({
            status: 'success', table: { columns: [], rows: [] },
        }))).toThrow('returned no rows');
        expect(() => parseQueryOutput('not-json')).toThrow('did not return valid JSON');
        for (const result of [null, {}, { status: 'success', table: { rows: [[1]] } }]) {
            expect(() => parseQueryOutput(JSON.stringify(result))).toThrow('unexpected result shape');
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
            const packageEntry = fileURLToPath(import.meta.resolve('@microsoft/fabric-app-data-cli'));
            expect(execFileAsync).toHaveBeenLastCalledWith(
                process.execPath,
                buildQueryCliArgs(resolve(dirname(packageEntry), 'cli.js'), 'monthly', definition.query),
                { cwd: projectRoot, maxBuffer: 20 * 1024 * 1024, timeout: 120_000, windowsHide: true },
            );
            expect(server.close).not.toHaveBeenCalled();
        } finally {
            await loader?.close();
            await rm(projectRoot, { recursive: true, force: true });
        }
        expect(server.close).toHaveBeenCalledOnce();
    }, 30_000);

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
                [Object.assign(new Error(), { stdout: '{"status":"error","error":"Bad DAX"}' }), 'Fabric data CLI query failed: Bad DAX'],
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
