//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import type { ConnectorConfig, ConnectorsRuntime } from "@microsoft/rayfin-connectors";
import type { FabricSemanticModel } from "@microsoft/rayfin-connector-fabric-semanticmodel";
import { fabricSemanticModel } from "@microsoft/rayfin-connector-fabric-semanticmodel";

/**
 * Connectors this app can talk to, keyed by the connector name declared in
 * `rayfin.yml` under `connectors.<name>`.
 *
 * The index signature keeps every name usable without editing this file each
 * time you run `npx rayfin connector add`. Narrow it to the names you actually
 * use if you want the compiler to catch a typo in a connection alias:
 *
 * @example
 * export type AppConnectorsSchema = {
 *     salesModel: FabricSemanticModel<"executeQuery">;
 * };
 */
export type AppConnectorsSchema = Record<string, FabricSemanticModel<"executeQuery">>;

/** The one connector type this template's `AppConnectorsSchema` can describe. */
const SUPPORTED_CONNECTOR = "fabric-semanticmodel";

type ConnectorSchemaModule = { connectorConfig?: ConnectorConfig };

/**
 * Every connector `npx rayfin connector add` has scaffolded.
 *
 * `add` writes `rayfin/connectors/<name>/schema.ts`, so that directory is the
 * single source of truth and this file never has to be hand-edited. Eager
 * globbing makes the wiring a build-time fact: a connector that is scaffolded is
 * wired, and one that is not is absent from both maps rather than half-present
 * in one of them.
 */
const schemaModules = import.meta.glob<ConnectorSchemaModule>(
    "../../rayfin/connectors/*/schema.ts",
    { eager: true },
);

/**
 * `../../rayfin/connectors/salesModel/schema.ts` -> `salesModel`.
 *
 * @internal Exported for tests; `npx rayfin connector add` is the supported way in.
 */
export function connectorNameFromPath(modulePath: string): string {
    const segments = modulePath.split("/").filter(Boolean);
    return segments.length >= 2 ? segments[segments.length - 2] : "";
}

/**
 * Turn scaffolded schema modules into the config map.
 *
 * Every failure here throws rather than skipping the entry. A connector missing
 * from the config map throws `UNKNOWN_CONNECTOR` only on first use, and one
 * missing from the runtime map does not throw at all — it hands the app an
 * undecoded payload. Both land far from their cause; a load-time throw does not.
 *
 * @internal Exported for tests; the module wires itself at import time.
 */
export function wireConnectors(modules: Record<string, ConnectorSchemaModule>): Record<string, ConnectorConfig> {
    const configs: Record<string, ConnectorConfig> = {};

    for (const modulePath of Object.keys(modules).sort()) {
        const name = connectorNameFromPath(modulePath);
        const config = modules[modulePath]?.connectorConfig;

        if (!name) {
            throw new Error(
                `Could not read a connector name from "${modulePath}". ` +
                "Expected `rayfin/connectors/<name>/schema.ts`.",
            );
        }
        if (!config) {
            throw new Error(
                `rayfin/connectors/${name}/schema.ts does not export \`connectorConfig\`. ` +
                "Re-run `npx rayfin connector add` for this connector, or delete the " +
                "directory if it is stale.",
            );
        }
        if (config.connector !== SUPPORTED_CONNECTOR) {
            throw new Error(
                `Connector "${name}" is of type "${config.connector}", but this app's ` +
                `AppConnectorsSchema describes only "${SUPPORTED_CONNECTOR}". Import that ` +
                "connector's runtime and widen AppConnectorsSchema in src/lib/connectors.ts, " +
                "or remove the connector.",
            );
        }

        configs[name] = config;
    }

    return configs;
}

/**
 * Routing config for each connector, keyed by the connector name.
 *
 * Derived from the scaffolded `rayfin/connectors/*` directories, so
 * `npx rayfin connector add` and `remove` are the only things that change it.
 * Do not hand-edit.
 */
export const connectorConfigs: Record<string, ConnectorConfig> = wireConnectors(schemaModules);

/**
 * Per-connector runtime hooks, keyed by the same name again.
 *
 * Built from {@link connectorConfigs}, so the two maps cannot drift apart:
 * `fabric-semanticmodel` returns an Apache Arrow stream and picks its transport
 * from where the app is running, and both live in the runtime, so a connector
 * without one silently fails to decode.
 *
 * The shape of this declaration is load-bearing beyond the app. The eval
 * harness rewrites it to render outside Fabric, matching a top-level
 * `export const connectorRuntimes`, a closing `};` at column zero, and exactly
 * one `fabricSemanticModel(...)` call inside. Keep all three — see
 * `connectors.spec.ts`, which asserts them.
 *
 * @remarks
 * Do not pass a `target`. The workspace and item ids come from `rayfin.yml` and
 * are injected by whatever answers the Rayfin API, so the app never needs to
 * know them. Deriving one from a `VITE_*` variable throws at module load,
 * because `rayfin env` emits a fixed set of variables and a per-model URL is
 * not among them.
 */
export const connectorRuntimes: ConnectorsRuntime = {
    ...Object.fromEntries(
        Object.keys(connectorConfigs).map((name) => [name, fabricSemanticModel({})]),
    ),
};
