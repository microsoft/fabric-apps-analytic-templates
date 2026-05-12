//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import RayfinClient from "@microsoft/rayfin-client";

let _client: RayfinClient | undefined;

/**
 * Returns the singleton RayfinClient.
 *
 * Lazily constructs the client from `VITE_RAYFIN_BASE_URL` and
 * `VITE_RAYFIN_PUBLISHABLE_KEY`. Throws if either is missing — callers
 * (e.g. the AuthProvider) should catch and surface as a user-visible
 * error rather than crashing during render.
 */
export function getRayfinClient(): RayfinClient {
    if (_client) return _client;

    const baseUrl = import.meta.env.VITE_RAYFIN_BASE_URL;
    const publishableKey = import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY;

    if (!baseUrl || !publishableKey) {
        throw new Error(
            "RayfinClient requires VITE_RAYFIN_BASE_URL and VITE_RAYFIN_PUBLISHABLE_KEY to be set.",
        );
    }

    _client = new RayfinClient({
        baseUrl,
        publishableKey,
        authStorage: true,
    });

    return _client;
}
