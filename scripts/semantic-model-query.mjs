//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';

import { resolveProjectRoots, withRayfinCliLock } from '@microsoft/fabric-app-semantic-model-tools/connector';
import { getRayfinAuth, loadAuthState } from '@microsoft/rayfin-cli/_internal/auth';
import { fabricSemanticModel, resolveTarget } from '@microsoft/rayfin-connector-fabric-semanticmodel';
import { createConnectorsApi } from '@microsoft/rayfin-connectors';
import { ApiClient } from '@microsoft/rayfin-lib';
import { parse as parseYaml } from 'yaml';

/**
 * Rows a validation query may return. Sent as the connector's `resultSetRowCountLimit`,
 * which truncates silently: a larger result is validated on its first rows only.
 */
const QUERY_ROW_LIMIT = 1000;

const QUERY_TIMEOUT_MS = 120_000;
const TOKEN_RENEWAL_MARGIN_MS = 5 * 60_000;

/**
 * Power BI throttles DAX queries per user, and the agent's own `run-dax-query` calls share that
 * budget. A throttled query waits for the service's `Retry-After` (bounded) and is retried a few
 * times before it is reported.
 */
const MAX_THROTTLE_RETRIES = 3;
const DEFAULT_RETRY_AFTER_MS = 20_000;
const MAX_RETRY_AFTER_MS = 60_000;

const DEFAULT_FABRIC_API_URL = 'https://api.fabric.microsoft.com/v1';
const POWER_BI_AUDIENCE = 'https://analysis.windows.net/powerbi/api';
const POWER_BI_INT_AUDIENCE = 'https://analysis.windows-int.net/powerbi/api';

/** Fields of the environment `rayfin login` saves, and the RAYFIN_* setting each one supplies. */
const SAVED_LOGIN_SETTINGS = {
    authorityHost: 'RAYFIN_AUTHORITY_HOST',
    clientId: 'RAYFIN_CLIENT_ID',
    fabricScope: 'RAYFIN_FABRIC_SCOPE',
    fabricApiUrl: 'RAYFIN_FABRIC_API_URL',
    fabricPortalUrl: 'RAYFIN_FABRIC_PORTAL_URL',
};

/**
 * Creates executeQuery(connection, query), which runs a factory's DAX against a
 * semantic-model connector declared in `rayfin/rayfin.yml` and returns its { columns, rows }.
 *
 * Queries run in this process through the same connector client `rayfin connector invoke`
 * builds, rather than through a Rayfin CLI process per visual. A Power BI token is reused until
 * it nears expiry, and only acquiring it holds the Rayfin CLI lock from
 * `@microsoft/fabric-app-semantic-model-tools`, because it reads the saved login that Rayfin CLI
 * processes running together can lose. RAYFIN_* settings are resolved as the Rayfin CLI resolves
 * them (see {@link applyRayfinSettings}).
 *
 * Each query is capped at {@link QUERY_ROW_LIMIT} rows, so a visual is validated against at
 * most its first 1000 rows. Queries are expected one at a time: a throttled response is
 * attributed to the query in flight.
 */
export function createQueryExecutor({
    cwd = process.cwd(),
    env = process.env,
    fetch = globalThis.fetch,
    loadSavedLogin = loadAuthState,
    acquireToken = acquireRayfinPowerBiToken,
    sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
} = {}) {
    let setup;
    let authorization;
    let throttleMs;

    const apiClient = new ApiClient({
        baseUrl: '',
        publishableKey: 'rayfin-cli',
        timeout: QUERY_TIMEOUT_MS,
        // The connector reports a 429 as an ordinary failed result without Retry-After,
        // so the wait is read from the response here.
        fetch: async (input, init) => {
            const response = await fetch(input, init);
            if (response.status === 429) {
                throttleMs = retryAfterMs(response.headers.get('retry-after'));
            }
            return response;
        },
    });

    function getSetup() {
        setup ??= (async () => {
            const { projectRoot } = resolveProjectRoots(resolve(cwd));
            await applyRayfinSettings(projectRoot, env, loadSavedLogin);
            const target = powerBiTarget(env);
            const connectors = await loadSemanticModelConnectors(
                projectRoot,
                apiClient,
                target.fabricApi,
                getAuthorization,
            );
            return { target, ...connectors };
        })();
        return setup;
    }

    async function getAuthorization() {
        const { target } = await getSetup();
        if (authorization === undefined || Date.now() >= (await authorization).renewAt) {
            authorization = getPowerBiAuthorization(env, target, acquireToken);
        }
        return (await authorization).header;
    }

    return async function executeQuery(connection, query) {
        const { clients, problems } = await getSetup();
        const client = clients.get(connection);
        if (!client) {
            throw new Error(problems.get(connection)
                ?? `Connector "${connection}" is not declared in rayfin/rayfin.yml. `
                + 'Run `npx rayfin connector list` to see the declared connector names.');
        }
        await getAuthorization();

        for (let attempt = 0; ; attempt += 1) {
            throttleMs = undefined;
            let result;
            try {
                result = await client.executeQuery({ query, resultSetRowCountLimit: QUERY_ROW_LIMIT });
            } catch (error) {
                throw new Error(
                    `Semantic model query failed: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
            if (throttleMs === undefined || result?.status !== 'error') {
                return toQueryTable(result);
            }
            if (attempt === MAX_THROTTLE_RETRIES) {
                throw new Error(
                    'Power BI is throttling DAX queries (HTTP 429), and this query was still throttled after '
                    + `${MAX_THROTTLE_RETRIES} retries. Try again later.`,
                );
            }
            await sleep(throttleMs);
        }
    };
}

/**
 * Reads the semantic-model connectors from `rayfin/rayfin.yml` and builds one client per
 * connector that has a usable { workspaceId, itemId } target. Connectors that cannot be queried
 * get an explanation instead, keyed by name.
 */
async function loadSemanticModelConnectors(projectRoot, apiClient, fabricApi, getAuthorization) {
    const problems = new Map();
    const configs = {};
    const runtimes = {};
    for (const connector of await readRayfinConnectors(projectRoot)) {
        if (typeof connector?.name !== 'string') {
            continue;
        }
        if (connector.type !== 'fabric-semanticmodel') {
            problems.set(
                connector.name,
                `Connector "${connector.name}" is a ${connector.type} connector; `
                + 'validate:visual queries fabric-semanticmodel connectors only.',
            );
            continue;
        }
        const { workspaceId, itemId } = connector;
        const connectorTarget = workspaceId && itemId ? resolveTarget({ workspaceId, itemId }) : undefined;
        if (!connectorTarget) {
            problems.set(
                connector.name,
                `Connector "${connector.name}" is missing workspaceId/itemId in rayfin/rayfin.yml. Add both `
                + "under the connector's `config:` block, or re-run `npx rayfin connector add` to populate them.",
            );
            continue;
        }
        configs[connector.name] = { connector: connector.type };
        runtimes[connector.name] = fabricSemanticModel({
            target: connectorTarget,
            endpoints: { fabricApi },
            getToken: getAuthorization,
        });
    }

    const api = createConnectorsApi(apiClient, configs, runtimes, { type: 'cli' });
    return {
        clients: new Map(Object.keys(runtimes).map((name) => [name, api[name]])),
        problems,
    };
}

/**
 * Returns the connectors `rayfin/rayfin.yml` declares, as the { name, type, workspaceId, itemId }
 * that validate:visual uses. Like the Rayfin CLI, it also reads the legacy forms: a map keyed by
 * connector name instead of a list, and `connector:` instead of `type:` (`type:` wins when an
 * entry has both). The spec checks this against the installed Rayfin CLI's `connector list`.
 */
export async function readRayfinConnectors(projectRoot) {
    let config;
    try {
        config = parseYaml(await readFile(resolve(projectRoot, 'rayfin', 'rayfin.yml'), 'utf8'));
    } catch (error) {
        throw new Error(
            `Could not read rayfin/rayfin.yml: ${error instanceof Error ? error.message : String(error)}`,
        );
    }

    let entries = config?.connectors;
    if (!Array.isArray(entries)) {
        entries = entries !== null && typeof entries === 'object'
            ? Object.entries(entries).map(([name, entry]) => ({ name, ...entry }))
            : [];
    }
    return entries.map((entry) => ({
        name: entry?.name,
        type: entry?.type ?? entry?.connector,
        workspaceId: entry?.config?.workspaceId,
        itemId: entry?.config?.itemId,
    }));
}

/**
 * Fills in the RAYFIN_* settings the Rayfin CLI applies before `connector invoke` runs. A value
 * already in the environment wins, then the environment `rayfin login` saved in
 * `~/.rayfin/auth.json`, then `rayfin/.env` (or `RAYFIN_ENV_FILE`). The values are written into
 * `env` (`process.env` by default) because the Rayfin sign-in reads its client ID and authority
 * from `process.env`.
 */
async function applyRayfinSettings(projectRoot, env, loadSavedLogin) {
    let environmentConfig;
    try {
        environmentConfig = (await loadSavedLogin())?.environmentConfig;
    } catch {
        // Without a readable saved login there are no saved settings; signing in reports its own failure.
    }
    for (const [field, name] of Object.entries(SAVED_LOGIN_SETTINGS)) {
        const value = environmentConfig?.[field];
        if (env[name] === undefined && typeof value === 'string' && value.length > 0) {
            env[name] = value;
        }
    }

    const envFile = resolve(projectRoot, env.RAYFIN_ENV_FILE || join('rayfin', '.env'));
    let text;
    try {
        text = await readFile(envFile, 'utf8');
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return;
        }
        throw new Error(`Could not read ${envFile}: ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const [name, value] of Object.entries(parseEnv(text))) {
        if (name.startsWith('RAYFIN_') && env[name] === undefined) {
            env[name] = value;
        }
    }
}

/**
 * Resolves the Fabric API and the Power BI token scope the way `rayfin connector invoke` does.
 * A Fabric host is always addressed as `<origin>/v1`, while another host (a proxy) keeps its path.
 * `RAYFIN_DB_TOKEN_SCOPE` wins; otherwise a Fabric host gets the production Power BI audience and
 * any other host the INT audience.
 */
function powerBiTarget(env) {
    let url;
    try {
        url = new URL(env.RAYFIN_FABRIC_API_URL?.trim() || DEFAULT_FABRIC_API_URL);
    } catch {
        throw new Error(`RAYFIN_FABRIC_API_URL is not a valid URL: ${env.RAYFIN_FABRIC_API_URL}`);
    }
    const isFabricHost = url.hostname.toLowerCase().replace(/\.$/, '').endsWith('.fabric.microsoft.com');
    const path = url.pathname.replace(/\/+$/, '');
    const fabricApi = isFabricHost
        ? `${url.origin}/v1`
        : `${url.origin}${path.endsWith('/v1') ? path : `${path}/v1`}`;

    const scopeOverride = env.RAYFIN_DB_TOKEN_SCOPE?.trim();
    if (scopeOverride) {
        return {
            fabricApi,
            scope: scopeOverride,
            audience: scopeOverride.replace(/\/\.default$/, '').replace(/\/+$/, ''),
        };
    }
    const audience = isFabricHost ? POWER_BI_AUDIENCE : POWER_BI_INT_AUDIENCE;
    return { fabricApi, scope: `${audience}/.default`, audience };
}

/** Returns { header, renewAt }: the Authorization header and when to acquire a fresh token. */
async function getPowerBiAuthorization(env, { scope, audience }, acquireToken) {
    const ambientToken = env.RAYFIN_TOKEN?.trim().replace(/^Bearer\s+/i, '');
    if (ambientToken) {
        return { header: `Bearer ${ambientToken}`, renewAt: Infinity };
    }
    let result;
    try {
        result = await acquireToken(scope);
    } catch (error) {
        throw new Error(
            'Not signed in, or no Power BI token could be acquired without an interactive prompt '
            + `(${error instanceof Error ? error.message : String(error)}). Sign in with \`npx rayfin login\` `
            + 'and retry. If you are already signed in, grant Power BI consent once by running '
            + '`npx rayfin connector invoke` for this connector without `--json`, or set RAYFIN_TOKEN to an '
            + `access token for ${audience}.`,
        );
    }
    // A run can outlast one token. MSAL serves a cached token until five minutes before it
    // expires, so a fresh one is acquired at that point too (immediately when the expiry is unknown).
    return {
        header: `Bearer ${result.token}`,
        renewAt: (result.expiresOnTimestamp || 0) - TOKEN_RENEWAL_MARGIN_MS,
    };
}

/** Reads the saved Rayfin login silently, holding the Rayfin CLI lock while it does. */
function acquireRayfinPowerBiToken(scope) {
    return withRayfinCliLock(async () => {
        const auth = await getRayfinAuth();
        return auth.acquireToken([scope], { silentOnly: true });
    });
}

function retryAfterMs(header) {
    let ms = DEFAULT_RETRY_AFTER_MS;
    if (header) {
        const seconds = Number(header);
        ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
    }
    return Math.min(Math.max(Number.isFinite(ms) ? ms : DEFAULT_RETRY_AFTER_MS, 0), MAX_RETRY_AFTER_MS);
}

/**
 * Returns the { columns, rows } table of a successful connector result. Rejects failed and
 * malformed results, and empty data, before rendering.
 */
export function toQueryTable(result) {
    if (result?.status === 'error') {
        const error = result.error ?? {};
        const message = typeof error === 'string' ? error : error.message ?? JSON.stringify(error);
        // The connector puts the actionable fix (for example, which access to check) in
        // `recoveryHint`, so it must not be dropped.
        const recovery = typeof error.recoveryHint === 'string' && error.recoveryHint.trim()
            ? ` ${error.recoveryHint.trim()}`
            : '';
        throw new Error(`Semantic model query failed: ${message}${recovery}`);
    }

    if (
        result?.status !== 'success'
        || !Array.isArray(result.table?.columns)
        || !Array.isArray(result.table?.rows)
    ) {
        throw new Error('The semantic model query returned an unexpected result shape.');
    }

    if (result.table.rows.length === 0) {
        throw new Error('The query succeeded but returned no rows to render.');
    }

    return result.table;
}
