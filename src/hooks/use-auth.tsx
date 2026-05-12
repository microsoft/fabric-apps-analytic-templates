//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { initEmbeddedAuth } from "@microsoft/rayfin-auth-provider-fabric";
import type { OpaqueSession } from "@microsoft/rayfin-auth";

import { getRayfinClient } from "@/lib/rayfin-client";
import { getFabricAuthOptions } from "@/lib/fabric-auth";
import { AuthContext, type AuthContextValue } from "./auth.context";

interface AuthProviderProps {
    children: ReactNode;
}

/**
 * AuthProvider — runs the Fabric embedded auth handoff once on mount.
 *
 * Behavior:
 * - When loaded inside a Fabric iframe (`?fabricEmbedded=true`), calls
 *   `initEmbeddedAuth` to acquire a Rayfin session via postMessage.
 * - When loaded standalone, `initEmbeddedAuth` returns `null` immediately
 *   and the provider settles in an unauthenticated state — no errors,
 *   no popup, the rest of the app renders normally.
 * - Missing env vars are caught and surfaced via `error`, never thrown
 *   during render.
 *
 * Consume the session with the `useAuth` hook (`@/hooks/auth.context`).
 */
export function AuthProvider({ children }: AuthProviderProps) {
    const [session, setSession] = useState<OpaqueSession | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                const client = getRayfinClient();
                const options = getFabricAuthOptions();
                const result = await initEmbeddedAuth(client.auth, options);
                if (!cancelled) setSession(result);
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err : new Error(String(err)));
                }
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    const value = useMemo<AuthContextValue>(
        () => ({
            session,
            isAuthenticated: session?.isAuthenticated ?? false,
            isLoading,
            error,
        }),
        [session, isLoading, error],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
