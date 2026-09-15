//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { OpaqueSession } from "@microsoft/rayfin-auth";

import { IAuthService } from "@/services/rayfin-auth.service";
import { AuthContext, type AuthContextValue } from "./auth.context";

interface AuthProviderProps {
    children: ReactNode;
    rayfinAuthService: IAuthService;
}

/**
 * AuthProvider — runs the Fabric embedded auth handoff once on mount.
 *
 * Behavior:
 * - When loaded inside a Fabric iframe (`?fabricEmbedded=true`), calls
 *   `initEmbeddedAuth` to acquire a Rayfin session via postMessage.
 * - When loaded standalone, `initEmbeddedAuth` returns `null` immediately
 *   and the provider settles in an unauthenticated state so `<AuthGate>`
 *   can offer interactive Fabric sign-in.
 *
 * Consume the session with the `useAuth` hook.
 */
export function AuthProvider({ children, rayfinAuthService }: AuthProviderProps) {
    const [session, setSession] = useState<OpaqueSession | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [isSigningIn, setIsSigningIn] = useState(false);
    const [signInError, setSignInError] = useState<Error | null>(null);
    const signInRequestRef = useRef<Promise<OpaqueSession> | null>(null);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                const result = await rayfinAuthService.initEmbeddedAuth();
                if (cancelled)
                    return;
                setSession(result);
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
    }, [rayfinAuthService]);

    const signIn = useCallback(() => {
        if (signInRequestRef.current)
            return;

        let request: Promise<OpaqueSession>;
        try {
            // Keep the SDK invocation in the synchronous click call stack so
            // its broker window is not blocked as an unsolicited popup.
            request = rayfinAuthService.signIn();
        } catch (err) {
            setSignInError(err instanceof Error ? err : new Error(String(err)));
            return;
        }

        signInRequestRef.current = request;
        setIsSigningIn(true);
        setSignInError(null);

        void request
            .then(setSession)
            .catch((err: unknown) => {
                setSignInError(err instanceof Error ? err : new Error(String(err)));
            })
            .finally(() => {
                if (signInRequestRef.current === request) {
                    signInRequestRef.current = null;
                    setIsSigningIn(false);
                }
            });
    }, [rayfinAuthService]);

    const value = useMemo<AuthContextValue>(
        () => ({
            session,
            isAuthenticated: session?.isAuthenticated ?? false,
            isLoading,
            error,
            signIn,
            isSigningIn,
            signInError,
        }),
        [session, isLoading, error, signIn, isSigningIn, signInError],
    );

    if (error)
        throw error;

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}