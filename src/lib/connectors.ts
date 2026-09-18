//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import type { ConnectorConfig, ConnectorsRuntime } from "@microsoft/rayfin-connectors";
import type { FabricSemanticModel } from "@microsoft/rayfin-connector-fabric-semanticmodel";

/**
 * Connectors this app can talk to, keyed by the connector name declared in
 * `rayfin.yml` under `connectors.<name>`.
 *
 * The index signature keeps every name usable without editing this file each
 * time you run `rayfin connector add`. Narrow it to the names you actually
 * use if you want the compiler to catch a typo in a connection alias:
 *
 * @example
 * export type AppConnectorsSchema = {
 *     salesModel: FabricSemanticModel<"executeQuery">;
 * };
 */
export type AppConnectorsSchema = Record<string, FabricSemanticModel<"executeQuery">>;

/**
 * Routing config for each connector, keyed by the same name used above.
 *
 * `rayfin connector add` owns this wiring. Once this file carries the CLI's
 * generated-file marker, both maps below are rewritten from `rayfin.yml` on
 * every add and remove, so they cannot drift. Until then the CLI prints the
 * wiring it would have written and you paste it in here, which is the one step
 * easy to miss: a connector present in `rayfin.yml` but absent from
 * `connectorConfigs` throws `UNKNOWN_CONNECTOR` on first use, and one absent
 * from `connectorRuntimes` fails silently by handing the app an undecoded
 * payload.
 *
 * @example
 * import { connectorConfig as salesModel } from "../../rayfin/connectors/salesModel/schema";
 *
 * export const connectorConfigs: Record<string, ConnectorConfig> = { salesModel };
 */
export const connectorConfigs: Record<string, ConnectorConfig> = {};

/**
 * Per-connector runtime hooks, keyed by the same name again.
 *
 * `fabric-semanticmodel` returns an Apache Arrow stream and picks its transport
 * based on where the app is running, and both of those live in the runtime — so
 * a connector left out of this map falls back to the plain JSON pass-through and
 * will not decode. Register one runtime per semantic model; the connectors layer
 * already keys instances by name.
 *
 * @example
 * import { fabricSemanticModel } from "@microsoft/rayfin-connector-fabric-semanticmodel";
 *
 * export const connectorRuntimes: ConnectorsRuntime = {
 *     salesModel: fabricSemanticModel({}),
 * };
 *
 * @remarks
 * Do not pass a `target`. The workspace and item ids come from `rayfin.yml` and
 * are injected by whatever answers the Rayfin API, so the app never needs to
 * know them. Deriving one from a `VITE_*` variable throws at module load,
 * because `rayfin env` emits a fixed set of variables and a per-model URL is
 * not among them.
 */
export const connectorRuntimes: ConnectorsRuntime = {};
