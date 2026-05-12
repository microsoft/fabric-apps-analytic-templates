//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import type { FabricAuthOptions } from "@microsoft/rayfin-auth-provider-fabric";

/**
 * Builds the FabricAuthOptions used by the Rayfin Fabric auth provider.
 *
 * Reads `VITE_FABRIC_WORKSPACE_ID`, `VITE_FABRIC_ITEM_ID`, and
 * `VITE_FABRIC_PORTAL_URL` from Vite env. Throws if any are missing —
 * callers should catch and surface via the AuthProvider's `error` state.
 *
 * `npx rayfin up` writes these env vars into `.env.fabric*` automatically.
 */
export function getFabricAuthOptions(): FabricAuthOptions {
    const workspaceId = import.meta.env.VITE_FABRIC_WORKSPACE_ID;
    const projectId = import.meta.env.VITE_FABRIC_ITEM_ID;
    const fabricPortalUrl = import.meta.env.VITE_FABRIC_PORTAL_URL;

    if (!workspaceId || !projectId || !fabricPortalUrl) {
        throw new Error(
            "Fabric auth requires VITE_FABRIC_WORKSPACE_ID, VITE_FABRIC_ITEM_ID, and VITE_FABRIC_PORTAL_URL to be set.",
        );
    }

    return {
        workspaceId,
        projectId,
        fabricPortalUrl,
        returnOrigin: window.location.origin,
    };
}
