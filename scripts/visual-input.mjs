//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createServer } from 'vite';

const execFileAsync = promisify(execFile);

/**
 * Rows a validation query may return. Sent as the connector's `resultSetRowCountLimit`,
 * which truncates silently: a larger result is validated on its first rows only.
 */
const QUERY_ROW_LIMIT = 1000;

/**
 * Imports query factories, executes their DAX queries, and prepares specs and data for rendering.
 * Returns { load, close }; 
 * load({ factoryPath, params }) returns { factoryName, definition, queryTable, dataTable } 
 * without rendering a visual. Shares one Vite server across loads.
 * Remember to call close() after the loader is done being used.
 */
export async function createVisualInputLoader(projectRoot = process.cwd()) {
    projectRoot = resolve(projectRoot);
    const server = await createServer({
        root: projectRoot,
        appType: 'custom',
        logLevel: 'error',
        server: { middlewareMode: true },
    });

    try {
        // Use the app's converter so validation applies the same column aliases and metadata as the UI.
        const dataTableModule = await server.ssrLoadModule('/src/lib/to-data-table.ts');
        if (typeof dataTableModule.toDataTable !== 'function') {
            throw new Error('Expected src/lib/to-data-table.ts to export toDataTable().');
        }

        return {
            async load({ factoryPath, params }) {
                const { definition, factoryName } = await loadVisualDefinition(
                    server,
                    projectRoot,
                    factoryPath,
                    params,
                );
                const queryTable = await executeQuery(projectRoot, definition.connection, definition.query);
                const dataTable = dataTableModule.toDataTable(queryTable, definition.columnMetadata);

                return { factoryName, definition, queryTable, dataTable };
            },
            close: () => server.close(),
        };
    } catch (error) {
        await server.close();
        throw error;
    }
}

/**
 * Parses command-line arguments into { factoryPath, params } items for visual validation.
 * Each request is one factory invocation.
 * Call again with different JSON objects to validate parameter variants of the same visual.
 */
export function parseValidationRequests(args) {
    if (args.length === 0) {
        throw new Error(
            'Usage: npm run validate:visual -- '
            + '<query-factory.ts> [factory-params-json] '
            + '[<query-factory.ts> [factory-params-json] ...]',
        );
    }

    const requests = [];
    for (let index = 0; index < args.length;) {
        const factoryPath = args[index];
        if (!factoryPath.toLowerCase().endsWith('.ts')) {
            throw new Error(`Expected a query-factory .ts path, received: ${factoryPath}`);
        }
        index += 1;

        let params;
        // A following .ts path starts another request; anything else must be this factory's JSON parameters.
        if (index < args.length && !args[index].toLowerCase().endsWith('.ts')) {
            try {
                params = parseFactoryParams(args[index]);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(`Invalid parameters for ${factoryPath}: ${message}`);
            }
            index += 1;
        }

        requests.push({ factoryPath, params });
    }

    return requests;
}

/**
 * Imports and calls a factory, then checks its visual definition:
 * { connection, query, columnMetadata, vegaLiteSpec }, query being DAX.
 */
async function loadVisualDefinition(server, projectRoot, factoryPath, params) {
    const modulePath = getProjectModulePath(projectRoot, factoryPath);
    // Vite resolves TypeScript and app-specific imports such as .dax?raw that Node cannot load directly.
    const factoryModule = await server.ssrLoadModule(modulePath);
    const { factoryName, factory } = findFactoryExport(factoryModule, factoryPath);

    const definition = await factory(params);
    if (
        typeof definition !== 'object'
        || definition === null
        || typeof definition.connection !== 'string'
        || typeof definition.query !== 'string'
        || typeof definition.columnMetadata !== 'object'
        || definition.columnMetadata === null
        || typeof definition.vegaLiteSpec !== 'object'
        || definition.vegaLiteSpec === null
    ) {
        throw new Error(
            `${factoryName} must return { connection, query, columnMetadata, vegaLiteSpec }.`,
        );
    }

    return { definition, factoryName };
}

/**
 * Runs a DAX query against the named semantic-model connection with the Rayfin CLI.
 * The query is handed over in a temporary JSON payload file rather than on the command
 * line, because DAX and connector names originate from untrusted model and user text.
 * Rayfin rejects `--file` paths outside the project, so the short-lived payload
 * directory is created inside the app (and ignored by git) rather than in the OS temp directory.
 *
 * The payload caps the result at {@link QUERY_ROW_LIMIT} rows, so a visual is validated
 * against at most its first 1000 rows. The result is read back from `--output-file` rather
 * than from the JSON envelope: the CLI shrinks an inline result larger than 8 KB to a preview,
 * whereas the explicit destination always receives every returned row.
 */
async function executeQuery(projectRoot, connection, query) {
    // The package exposes its own package.json, so the bin script can be located without
    // guessing at a file adjacent to the library entry point.
    const packageJson = fileURLToPath(import.meta.resolve('@microsoft/rayfin-cli/package.json'));
    const cliEntry = resolve(dirname(packageJson), 'scripts', 'main');

    const queryDirectory = await mkdtemp(resolve(projectRoot, '.lyra-rayfin-'));
    const payloadPath = resolve(queryDirectory, 'visual.query.json');
    const resultPath = resolve(queryDirectory, 'visual.result.json');
    try {
        await writeFile(
            payloadPath,
            JSON.stringify({ query, resultSetRowCountLimit: QUERY_ROW_LIMIT }),
            'utf8',
        );
        const args = buildQueryCliArgs(cliEntry, connection, payloadPath, resultPath);

        try {
            const { stdout } = await execFileAsync(process.execPath, args, {
                cwd: projectRoot,
                maxBuffer: 20 * 1024 * 1024,
                timeout: 120_000,
                windowsHide: true,
            });
            assertResultFile(parseInvokeEnvelope(stdout), resultPath);
        } catch (error) {
            if (
                typeof error === 'object'
                && error !== null
                && ('killed' in error && error.killed || 'signal' in error && error.signal)
            ) {
                throw new Error('The Rayfin connector invoke command timed out after 120 seconds.');
            }
            // A failed CLI process still reports the query failure as a JSON envelope on stdout.
            if (typeof error === 'object' && error !== null && 'stdout' in error && error.stdout) {
                parseInvokeEnvelope(String(error.stdout));
            }
            throw error;
        }

        let resultJson;
        try {
            resultJson = await readFile(resultPath, 'utf8');
        } catch {
            throw new Error('The Rayfin connector invoke command did not write a result file.');
        }
        return parseQueryResult(resultJson);
    } finally {
        await rm(queryDirectory, { recursive: true, force: true });
    }
}

/**
 * Checks the JSON envelope printed by `npx rayfin connector invoke --json` and returns it.
 * Both a CLI-level failure and a connector result that reports its own failure are rejected
 * here, because either one exits before a usable result file exists.
 */
export function parseInvokeEnvelope(stdout) {
    let envelope;
    try {
        // The CLI prints its envelope as the final stdout line; tolerate anything printed before it.
        const lastLine = stdout.split('\n').map((line) => line.trim()).filter(Boolean).at(-1);
        envelope = JSON.parse(lastLine ?? '');
    } catch {
        throw new Error('The Rayfin connector invoke command did not return valid JSON.');
    }

    for (const failure of [envelope, envelope?.output]) {
        if (failure?.status === 'error') {
            const message = typeof failure.error === 'string'
                ? failure.error
                : failure.error?.message ?? JSON.stringify(failure.error);
            // The CLI puts the actionable fix (for example, re-running without --json to
            // grant Power BI consent) only in `recovery`, so it must not be dropped.
            const recovery = typeof failure.recovery === 'string' && failure.recovery.trim()
                ? ` ${failure.recovery.trim()}`
                : '';
            throw new Error(`Rayfin connector invoke failed: ${message}${recovery}`);
        }
    }

    if (envelope?.status !== 'ok') {
        throw new Error('The Rayfin connector invoke command returned an unexpected result shape.');
    }

    return envelope;
}

/**
 * Confirms that the CLI wrote the whole query result to the requested `--output-file`.
 *
 * Two different limits apply, and only one is acceptable:
 * - The query itself is deliberately capped at {@link QUERY_ROW_LIMIT} rows through
 *   `resultSetRowCountLimit`, so the result file holds at most that many rows. That cap is
 *   intended: validation checks at most the first 1,000 rows of a result.
 * - The CLI may additionally shrink an inline result larger than 8 KB to a preview
 *   (`outputTruncated`). That preview is rejected: it drops rows from the capped result,
 *   so a visual validated against it would be validated against the wrong data.
 */
export function assertResultFile(envelope, resultPath) {
    if (typeof envelope.outputFile !== 'string') {
        throw new Error(envelope.outputTruncated
            ? 'The Rayfin connector invoke command returned a truncated preview without a result file.'
            : 'The Rayfin connector invoke command did not report the requested --output-file. '
                + 'Upgrade @microsoft/rayfin-cli to ^1.36.1 (npm install) and retry.');
    }
    if (resolve(envelope.outputFile) !== resolve(resultPath)) {
        throw new Error(
            `The Rayfin connector invoke command wrote its result to ${envelope.outputFile} `
            + 'instead of the requested --output-file.',
        );
    }
}

/**
 * Reads the full executeQuery result written to `--output-file` and returns its
 * { columns, rows } table. Rejects malformed results and empty data before rendering.
 */
export function parseQueryResult(resultJson) {
    let result;
    try {
        result = JSON.parse(resultJson);
    } catch {
        throw new Error('The Rayfin connector invoke result file did not contain valid JSON.');
    }

    if (
        result?.status !== 'success'
        || !Array.isArray(result.table?.columns)
        || !Array.isArray(result.table?.rows)
    ) {
        throw new Error('The Rayfin connector invoke command returned an unexpected result shape.');
    }

    if (result.table.rows.length === 0) {
        throw new Error('The query succeeded but returned no rows to render.');
    }

    return result.table;
}

export function buildQueryCliArgs(cliEntry, connection, payloadPath, resultPath) {
    return [
        cliEntry,
        'connector',
        'invoke',
        '--name',
        connection,
        '--operation',
        'executeQuery',
        '--file',
        payloadPath,
        '--output-file',
        resultPath,
        '--json',
    ];
}

export function findFactoryExport(factoryModule, factoryPath) {
    const factoryEntry = Object.entries(factoryModule)
        .find(([, value]) => typeof value === 'function');
    if (!factoryEntry) {
        const exports = Object.keys(factoryModule).join(', ') || '(none)';
        throw new Error(
            `Expected ${factoryPath} to export at least one factory function. `
            + `Available exports: ${exports}.`,
        );
    }

    const [factoryName, factory] = factoryEntry;
    return { factoryName, factory };
}

function getProjectModulePath(projectRoot, filePath) {
    const relativePath = relative(projectRoot, resolve(projectRoot, filePath));
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
        throw new Error(`Factory must be inside the app directory: ${filePath}`);
    }

    // ssrLoadModule expects an app-root URL, including forward slashes on Windows.
    return `/${relativePath.split(sep).join('/')}`;
}

function parseFactoryParams(paramsJson) {
    const params = JSON.parse(paramsJson);
    if (typeof params !== 'object' || params === null || Array.isArray(params)) {
        throw new Error('Factory parameters must be a JSON object.');
    }

    return params;
}
