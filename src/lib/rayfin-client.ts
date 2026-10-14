//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { ConnectorsRayfinClient } from "@microsoft/rayfin-client";
import type { EntitySchema } from "@microsoft/rayfin-data";
import type { FunctionsSchema } from "@microsoft/rayfin-functions";
import type { AppConnectorsSchema } from "@/lib/connectors";
import { connectorConfigs, connectorRuntimes } from "@/lib/connectors";

/**
 * The app's Rayfin client type. `ConnectorsRayfinClient` extends `RayfinClient`
 * with a typed `connectors` surface, so everything the plain client offers is
 * still available.
 */
export type AppRayfinClient = ConnectorsRayfinClient<
    EntitySchema,
    FunctionsSchema,
    AppConnectorsSchema
>;

let _client: AppRayfinClient | undefined;

/**
 * Returns the pre-configured RayfinClient singleton.
 *
 * Data sources are reached through `getRayfinClient().connectors.<name>`, where
 * `<name>` is a connector declared in `rayfin.yml`. The connector's target
 * workspace and item are resolved server-side from that file, so the app never
 * sends (or needs to know) a workspace id or item id.
 *
 * There is one transport: HTTP to `VITE_RAYFIN_API_URL`. A host that runs this
 * app before it is published points that variable at its own endpoint and
 * answers the same routes, so nothing here has to know where it is running.
 */
export function getRayfinClient(): AppRayfinClient {
    if (!_client) {
        const apiUrl = import.meta.env.VITE_RAYFIN_API_URL;
        const publishableKey = import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY;

        if (!apiUrl || !publishableKey) {
            throw new Error(`Missing required env vars for creating rayfin client - run 'npx rayfin up'`);
        }

        _client = new ConnectorsRayfinClient(
            {
                baseUrl: apiUrl,
                publishableKey,
                authStorage: true,
                connectors: connectorConfigs,
            },
            connectorRuntimes,
        );
    }

    return _client;
}