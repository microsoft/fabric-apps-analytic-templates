//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { execFile } from 'node:child_process';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createServer } from 'vite';

const execFileAsync = promisify(execFile);
const QUERY_ROW_LIMIT = '1000';

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
 * Runs a DAX query against the named semantic-model connection using fabric-app-data (data-cli).
 */
async function executeQuery(projectRoot, connection, query) {
    const packageEntry = fileURLToPath(import.meta.resolve('@microsoft/fabric-app-data-cli'));
    // The package entry is its library; the executable is the adjacent cli.js, run with the current Node.
    const cliEntry = resolve(dirname(packageEntry), 'cli.js');
    const args = buildQueryCliArgs(cliEntry, connection, query);

    try {
        const { stdout } = await execFileAsync(process.execPath, args, {
            cwd: projectRoot,
            maxBuffer: 20 * 1024 * 1024,
            timeout: 120_000,
            windowsHide: true,
        });
        return parseQueryOutput(stdout);
    } catch (error) {
        if (
            typeof error === 'object'
            && error !== null
            && ('killed' in error && error.killed || 'signal' in error && error.signal)
        ) {
            throw new Error('The Fabric data CLI query command timed out after 120 seconds.');
        }
        // A failed CLI process can still provide a structured DAX error in its JSON stdout.
        if (typeof error === 'object' && error !== null && 'stdout' in error && error.stdout) {
            return parseQueryOutput(String(error.stdout));
        }
        throw error;
    }
}

/**
 * Reads JSON output from fabric-app-data's DAX query command and returns its { columns, rows } table.
 * Rejects command errors, malformed results, and empty data before rendering.
 */
export function parseQueryOutput(stdout) {
    let result;
    try {
        result = JSON.parse(stdout);
    } catch {
        throw new Error('The Fabric data CLI query command did not return valid JSON.');
    }

    if (result?.status === 'error') {
        const message = typeof result.error === 'string'
            ? result.error
            : result.error?.message ?? JSON.stringify(result.error);
        throw new Error(`Fabric data CLI query failed: ${message}`);
    }

    if (
        result?.status !== 'success'
        || !Array.isArray(result.table?.columns)
        || !Array.isArray(result.table?.rows)
    ) {
        throw new Error('The Fabric data CLI query command returned an unexpected result shape.');
    }

    if (result.table.rows.length === 0) {
        throw new Error('The Fabric data CLI query succeeded but returned no rows to render.');
    }

    return result.table;
}

export function buildQueryCliArgs(cliEntry, connection, query) {
    return [
        cliEntry,
        'query',
        'semanticModel',
        connection,
        '--query',
        query,
        '--limit',
        QUERY_ROW_LIMIT,
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
