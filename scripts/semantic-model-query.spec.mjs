//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

// @vitest-environment node

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

import { tableFromArrays, tableToIPC } from 'apache-arrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acquireRayfinCliLock, withRayfinCliLock } from '@microsoft/fabric-app-semantic-model-tools/connector';
import { getRayfinAuth } from '@microsoft/rayfin-cli/auth';

import { createQueryExecutor, readRayfinConnectors, toQueryTable } from './semantic-model-query.mjs';

// The saved Rayfin login is stood in for; the real Rayfin CLI lock is observed.
vi.mock('@microsoft/rayfin-cli/auth', () => ({ getRayfinAuth: vi.fn(), loadAuthState: vi.fn() }));
vi.mock('@microsoft/fabric-app-semantic-model-tools/connector', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, withRayfinCliLock: vi.fn(actual.withRayfinCliLock) };
});

const workspaceId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const queryUrl = 'https://api.fabric.microsoft.com/v1.0/myorg/groups/'
    + `${workspaceId}/datasets/${itemId}/executeDaxQueries`;
const powerBiScope = 'https://analysis.windows.net/powerbi/api/.default';
const salesConnector = [
    '  - name: sales',
    '    type: fabric-semanticmodel',
    '    config:',
    `      workspaceId: ${workspaceId}`,
    `      itemId: ${itemId}`,
];
const queryTable = {
    columns: [{ name: '[Value]', dataType: 'number' }],
    rows: [[1]],
};

const requireFromSpec = createRequire(import.meta.url);
const rayfinCliPackage = requireFromSpec.resolve('@microsoft/rayfin-cli/package.json');
/** The installed Rayfin CLI's `rayfin` command. */
const rayfinCli = resolve(dirname(rayfinCliPackage), requireFromSpec(rayfinCliPackage).bin.rayfin);

const temporaryDirectories = [];
async function temporaryDirectory(prefix) {
    const directory = await mkdtemp(resolve(tmpdir(), prefix));
    temporaryDirectories.push(directory);
    return directory;
}

/** An app whose rayfin/rayfin.yml declares the given connector entries. */
async function createApp(connectorLines = salesConnector) {
    const root = await temporaryDirectory('semantic-model-query-app-');
    await mkdir(resolve(root, 'rayfin'));
    await writeFile(
        resolve(root, 'rayfin', 'rayfin.yml'),
        ['id: data-app', 'connectors:', ...connectorLines, ''].join('\n'),
    );
    return root;
}

/** A successful executeDaxQueries response, which Power BI returns as an Arrow IPC stream. */
function arrowResponse(values = [1]) {
    const table = tableFromArrays({ '[Value]': Int32Array.from(values) });
    return new Response(tableToIPC(table, 'stream'), {
        status: 200,
        headers: { 'content-type': 'application/vnd.apache.arrow.stream' },
    });
}

function errorResponse(status, message, headers = {}) {
    return new Response(JSON.stringify({ error: { code: 'Error', message } }), { status, headers });
}

/** A token result from the saved Rayfin login that expires in `minutes`. */
function tokenResult(token, minutes = 60) {
    return { token, expiresOnTimestamp: Date.now() + minutes * 60_000 };
}

function requestOf(fetch, call) {
    const [url, init] = fetch.mock.calls[call];
    return {
        url: String(url),
        authorization: new Headers(init.headers).get('authorization'),
        body: JSON.parse(init.body),
    };
}

/**
 * The connectors `rayfin connector list --json` reports for an app, run with the installed Rayfin
 * CLI. It runs without telemetry and against an empty home and config directory, so the
 * developer's Rayfin login is neither needed nor read.
 */
async function rayfinConnectorList(cwd) {
    const home = await temporaryDirectory('semantic-model-query-rayfin-home-');
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('RAYFIN_')));
    const { stdout } = await promisify(execFile)(process.execPath, [rayfinCli, 'connector', 'list', '--json'], {
        cwd,
        env: {
            ...env,
            HOME: home,
            USERPROFILE: home,
            RAYFIN_CONFIG_DIR: resolve(home, '.rayfin'),
            RAYFIN_TELEMETRY_OPTOUT: '1',
        },
    });
    return JSON.parse(stdout).map((connector) => ({
        name: connector.name,
        type: connector.type,
        workspaceId: connector.config?.workspaceId,
        itemId: connector.config?.itemId,
    }));
}

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(
        (directory) => rm(directory, { recursive: true, force: true }),
    ));
});

describe('semantic model queries', () => {
    it('returns a successful table and rejects failed, malformed, or empty results', () => {
        expect(toQueryTable({ status: 'success', table: queryTable })).toEqual(queryTable);
        // The connector's recovery hint is often the only actionable part of a failure.
        expect(() => toQueryTable({
            status: 'error',
            error: { category: 'api', message: 'Forbidden.', recoveryHint: 'Sign in again.' },
        })).toThrow(/^Semantic model query failed: Forbidden\. Sign in again\.$/);
        expect(() => toQueryTable({
            status: 'error',
            error: { category: 'query', message: 'Bad DAX', recoveryHint: ' ' },
        })).toThrow(/^Semantic model query failed: Bad DAX$/);
        expect(() => toQueryTable({ status: 'success', table: { columns: [], rows: [] } }))
            .toThrow('returned no rows');
        for (const result of [
            null,
            {},
            { status: 'success', table: { rows: [[1]] } },
            { status: 'success', table: { columns: [] } },
        ]) {
            expect(() => toQueryTable(result)).toThrow('unexpected result shape');
        }
    });

    it('queries the declared model in-process, reusing a Power BI token until it nears expiry', async () => {
        const cwd = await createApp();
        const acquireToken = vi.fn().mockResolvedValue(tokenResult('token-1'));
        const fetch = vi.fn(async () => arrowResponse([1, 2]));
        const executeQuery = createQueryExecutor({ cwd, env: {}, fetch, acquireToken });

        for (const query of ['EVALUATE {1}', 'EVALUATE {2}']) {
            await expect(executeQuery('sales', query)).resolves.toEqual({
                columns: [expect.objectContaining({ name: '[Value]' })],
                rows: [[1], [2]],
            });
        }
        expect(acquireToken).toHaveBeenCalledExactlyOnceWith(powerBiScope);
        expect(fetch).toHaveBeenCalledTimes(2);
        // The connector truncates to resultSetRowCountLimit silently: a visual is validated
        // against at most its first 1000 rows.
        expect(requestOf(fetch, 1)).toEqual({
            url: queryUrl,
            authorization: 'Bearer token-1',
            body: { query: 'EVALUATE {2}', resultSetRowCountLimit: 1000 },
        });

        // A token within five minutes of expiry is replaced before the next query uses it.
        acquireToken.mockReset()
            .mockResolvedValueOnce(tokenResult('expiring', 4))
            .mockResolvedValueOnce(tokenResult('renewed'));
        const renewing = createQueryExecutor({ cwd, env: {}, fetch, acquireToken });
        await renewing('sales', 'EVALUATE {3}');
        await renewing('sales', 'EVALUATE {4}');
        expect(acquireToken).toHaveBeenCalledTimes(2);
        expect(requestOf(fetch, 3).authorization).toBe('Bearer renewed');
    });

    it('resolves RAYFIN_* settings as the Rayfin CLI does: environment, then saved login, then rayfin/.env', async () => {
        const cwd = await createApp();
        await writeFile(resolve(cwd, 'rayfin', '.env'), [
            'RAYFIN_TOKEN=Bearer env-file-token',
            'RAYFIN_FABRIC_API_URL=https://dxtapi.fabric.microsoft.com',
            'RAYFIN_CLIENT_ID=env-file-client',
            'OTHER_SETTING=ignored',
        ].join('\n'));
        const env = { RAYFIN_CLIENT_ID: 'shell-client' };
        const acquireToken = vi.fn();
        const fetch = vi.fn(async () => arrowResponse());
        const executeQuery = createQueryExecutor({
            cwd,
            env,
            fetch,
            acquireToken,
            loadSavedLogin: async () => ({
                environmentConfig: { clientId: 'saved-client', fabricApiUrl: 'https://msitapi.fabric.microsoft.com/v1' },
            }),
        });

        await executeQuery('sales', 'EVALUATE {1}');
        expect(env).toEqual({
            RAYFIN_CLIENT_ID: 'shell-client',
            RAYFIN_FABRIC_API_URL: 'https://msitapi.fabric.microsoft.com/v1',
            RAYFIN_TOKEN: 'Bearer env-file-token',
        });
        // An ambient RAYFIN_TOKEN is used without reading the saved login.
        expect(acquireToken).not.toHaveBeenCalled();
        expect(requestOf(fetch, 0)).toMatchObject({
            url: queryUrl.replace('api.fabric', 'msitapi.fabric'),
            authorization: 'Bearer env-file-token',
        });
    });

    it('waits out Power BI throttling, and reports other failures and lasting throttling', async () => {
        const cwd = await createApp();
        const sleep = vi.fn().mockResolvedValue();
        const fetch = vi.fn()
            .mockResolvedValueOnce(errorResponse(429, 'Too many requests.', { 'retry-after': '2' }))
            .mockResolvedValueOnce(arrowResponse())
            .mockResolvedValueOnce(errorResponse(400, 'Bad DAX'));
        const executeQuery = createQueryExecutor({
            cwd, env: {}, fetch, acquireToken: async () => tokenResult('token'), sleep,
        });

        await expect(executeQuery('sales', 'EVALUATE {1}')).resolves.toMatchObject({ rows: [[1]] });
        expect(sleep).toHaveBeenCalledExactlyOnceWith(2000);
        expect(requestOf(fetch, 1).body).toEqual(requestOf(fetch, 0).body);

        // Only throttling is retried.
        await expect(executeQuery('sales', 'EVALUATE bad')).rejects.toThrow(
            /^Semantic model query failed: Bad DAX$/,
        );
        expect(sleep).toHaveBeenCalledOnce();

        sleep.mockClear();
        fetch.mockImplementation(async () => errorResponse(429, 'Too many requests.'));
        await expect(executeQuery('sales', 'EVALUATE {1}')).rejects.toThrow(
            /^Power BI is throttling DAX queries \(HTTP 429\), and this query was still throttled after 3 retries\. Try again later\.$/,
        );
        // Without Retry-After each wait defaults to 20 seconds.
        expect(sleep.mock.calls).toEqual([[20_000], [20_000], [20_000]]);
    });

    it('explains connectors and sign-in problems without sending a query', async () => {
        const cwd = await createApp([
            ...salesConnector,
            '  - name: orders',
            '    type: fabric-sqldatabase',
            '  - name: partial',
            '    type: fabric-semanticmodel',
            '    config:',
            `      workspaceId: ${workspaceId}`,
        ]);
        const fetch = vi.fn();
        const executeQuery = createQueryExecutor({
            cwd,
            env: {},
            fetch,
            acquireToken: vi.fn().mockRejectedValue(new Error('Silent token acquisition failed')),
        });

        await expect(executeQuery('missing', 'EVALUATE {1}')).rejects.toThrow(
            'Connector "missing" is not declared in rayfin/rayfin.yml.',
        );
        await expect(executeQuery('orders', 'EVALUATE {1}')).rejects.toThrow(
            'validate:visual queries fabric-semanticmodel connectors only',
        );
        await expect(executeQuery('partial', 'EVALUATE {1}')).rejects.toThrow(
            'Connector "partial" is missing workspaceId/itemId in rayfin/rayfin.yml.',
        );
        await expect(executeQuery('sales', 'EVALUATE {1}')).rejects.toThrow(new RegExp(
            '^Not signed in, .*\\(Silent token acquisition failed\\)\\. Sign in with `npx rayfin login` .*'
            + 'access token for https://analysis\\.windows\\.net/powerbi/api\\.$',
        ));
        await expect(createQueryExecutor({
            cwd: await temporaryDirectory('semantic-model-query-no-rayfin-'), env: {}, fetch,
        })('sales', 'EVALUATE {1}')).rejects.toThrow('Could not read rayfin/rayfin.yml');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('reads rayfin.yml connectors as the installed Rayfin CLI does, including the legacy forms', async () => {
        const otherWorkspaceId = '33333333-3333-4333-8333-333333333333';
        const otherItemId = '44444444-4444-4444-8444-444444444444';
        const sales = { name: 'sales', type: 'fabric-semanticmodel', workspaceId, itemId };
        const fixtures = [
            {
                connectorLines: [
                    // As `npx rayfin connector add` writes it (Rayfin CLI 1.36.1).
                    ...salesConnector,
                    '    auth:',
                    '      type: delegated',
                    '    version: "1"',
                    '    operations:',
                    '      - name: executeQuery',
                    // Legacy `connector:` in place of `type:`.
                    '  - name: legacy',
                    '    connector: fabric-semanticmodel',
                    '    config:',
                    `      workspaceId: ${otherWorkspaceId}`,
                    `      itemId: ${otherItemId}`,
                    '  - name: orders',
                    '    type: fabric-sqldatabase',
                    '    config:',
                    `      workspaceId: ${workspaceId}`,
                    `      itemId: ${otherItemId}`,
                ],
                expected: [
                    sales,
                    { name: 'legacy', type: 'fabric-semanticmodel', workspaceId: otherWorkspaceId, itemId: otherItemId },
                    { name: 'orders', type: 'fabric-sqldatabase', workspaceId, itemId: otherItemId },
                ],
            },
            {
                // Legacy map keyed by connector name.
                connectorLines: [
                    '  sales:',
                    '    connector: fabric-semanticmodel',
                    '    config:',
                    `      workspaceId: ${workspaceId}`,
                    `      itemId: ${itemId}`,
                    '  migrated:',
                    '    connector: fabric-sqldatabase',
                    '    type: fabric-semanticmodel',
                    '    config:',
                    `      workspaceId: ${otherWorkspaceId}`,
                    `      itemId: ${otherItemId}`,
                ],
                expected: [
                    sales,
                    { name: 'migrated', type: 'fabric-semanticmodel', workspaceId: otherWorkspaceId, itemId: otherItemId },
                ],
            },
        ];

        // Each Rayfin CLI run takes a few seconds to start, so the fixtures run at once.
        await Promise.all(fixtures.map(async ({ connectorLines, expected }) => {
            const app = await createApp(connectorLines);
            const rayfinCliConnectors = await rayfinConnectorList(app);
            expect(rayfinCliConnectors).toEqual(expected);
            expect(await readRayfinConnectors(app)).toEqual(rayfinCliConnectors);
        }));
    }, 60_000);

    it('reads the saved Rayfin login silently, and only while holding the Rayfin CLI lock', async () => {
        const configRoot = await temporaryDirectory('semantic-model-query-lock-');
        const previous = process.env.RAYFIN_CONFIG_DIR;
        process.env.RAYFIN_CONFIG_DIR = resolve(configRoot, 'rayfin');
        const acquireToken = vi.fn().mockResolvedValue(tokenResult('saved-token'));
        vi.mocked(getRayfinAuth).mockResolvedValue({ acquireToken });
        const fetch = vi.fn(async () => arrowResponse());
        const executeQuery = createQueryExecutor({ cwd: await createApp(), env: {}, fetch });
        try {
            // Another Rayfin CLI command holds the lock: the saved login must not be read until it ends.
            const release = await acquireRayfinCliLock();
            const pending = executeQuery('sales', 'EVALUATE {1}');
            await new Promise((resolveWait) => setTimeout(resolveWait, 300));
            expect(getRayfinAuth).not.toHaveBeenCalled();
            expect(fetch).not.toHaveBeenCalled();
            release();
            await expect(pending).resolves.toMatchObject({ rows: [[1]] });
            await executeQuery('sales', 'EVALUATE {2}');

            // A sign-in prompt would stall the validation run, so the token is acquired silently.
            expect(acquireToken).toHaveBeenCalledExactlyOnceWith([powerBiScope], { silentOnly: true });
            expect(withRayfinCliLock).toHaveBeenCalledOnce();
            expect(requestOf(fetch, 1).authorization).toBe('Bearer saved-token');
        } finally {
            if (previous === undefined) delete process.env.RAYFIN_CONFIG_DIR;
            else process.env.RAYFIN_CONFIG_DIR = previous;
        }
    });
});
