//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { type ReactNode } from "react";

import { useAuth } from "@/hooks/auth.context";

interface AuthGateProps {
    children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
    const {
        isLoading,
        isAuthenticated,
        signIn,
        isSigningIn,
        signInError,
    } = useAuth();

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background">
                <div className="text-sm text-muted-foreground">
                    Connecting to Fabric…
                </div>
            </div>
        );
    }

    if (!isAuthenticated) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background p-400">
                <div className="w-full max-w-md rounded-xl border border-border bg-card p-800 text-center shadow-8">
                    <h1 className="mb-200 text-500 font-semibold leading-500 text-card-foreground">
                        Sign in to open this app
                    </h1>
                    <p className="mb-600 text-300 leading-300 text-muted-foreground">
                        Use your Fabric account to access this app and its connected semantic models.
                    </p>
                    <button
                        type="button"
                        onClick={signIn}
                        disabled={isSigningIn}
                        aria-busy={isSigningIn}
                        className="rounded-lg bg-primary px-400 py-200 text-300 font-semibold text-primary-foreground hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isSigningIn ? "Signing in…" : "Sign in with Fabric"}
                    </button>
                    {signInError && (
                        <p
                            role="alert"
                            className="mt-400 text-300 leading-300 text-destructive"
                        >
                            We couldn't sign you in: {signInError.message} Please try again and allow pop-ups for this site.
                        </p>
                    )}
                </div>
            </div>
        );
    }

    return <>{children}</>;
}