//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { OpaqueSession } from "@microsoft/rayfin-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthGate } from "@/components/auth-gate.component";
import { AuthProvider } from "@/hooks/use-auth";
import type { IAuthService } from "@/services/rayfin-auth.service";

const authenticatedSession: OpaqueSession = {
    user: {
        id: "user-id",
        email: "user@example.com",
    },
    isAuthenticated: true,
    isAnonymous: false,
};

function createAuthService(
    overrides: Partial<IAuthService> = {},
): IAuthService {
    return {
        initEmbeddedAuth: vi.fn().mockResolvedValue(null),
        signIn: vi.fn().mockResolvedValue(authenticatedSession),
        ...overrides,
    };
}

function renderAuthGate(authService: IAuthService) {
    render(
        <AuthProvider rayfinAuthService={authService}>
            <AuthGate>
                <div>Authenticated app</div>
            </AuthGate>
        </AuthProvider>,
    );
}

describe("AuthGate", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("signs in from the standalone action and renders the app", async () => {
        const authService = createAuthService();
        renderAuthGate(authService);

        const signInButton = await screen.findByRole("button", {
            name: "Sign in with Fabric",
        });
        fireEvent.click(signInButton);

        expect(authService.signIn).toHaveBeenCalledOnce();
        expect(await screen.findByText("Authenticated app")).toBeInTheDocument();
    });

    it("shows an actionable standalone sign-in error without tearing down the auth gate", async () => {
        const authService = createAuthService({
            signIn: vi.fn().mockRejectedValue(new Error("The broker tab was blocked.")),
        });
        renderAuthGate(authService);

        fireEvent.click(await screen.findByRole("button", {
            name: "Sign in with Fabric",
        }));

        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("The broker tab was blocked.");
        expect(alert).toHaveTextContent("allow pop-ups for this site");
        expect(screen.getByRole("button", {
            name: "Sign in with Fabric",
        })).toBeEnabled();
    });

    it("disables the action and prevents duplicate requests while sign-in is pending", async () => {
        let resolveSignIn!: (session: OpaqueSession) => void;
        const signInRequest = new Promise<OpaqueSession>((resolve) => {
            resolveSignIn = resolve;
        });
        const signIn = vi.fn().mockReturnValue(signInRequest);
        const authService = createAuthService({ signIn });
        renderAuthGate(authService);

        const signInButton = await screen.findByRole("button", {
            name: "Sign in with Fabric",
        });
        fireEvent.click(signInButton);
        fireEvent.click(signInButton);

        expect(signIn).toHaveBeenCalledOnce();
        expect(screen.getByRole("button", {
            name: "Signing in…",
        })).toBeDisabled();

        resolveSignIn(authenticatedSession);
        expect(await screen.findByText("Authenticated app")).toBeInTheDocument();
    });

    it("preserves the embedded auth flow without invoking interactive sign-in", async () => {
        const initEmbeddedAuth = vi.fn().mockResolvedValue(authenticatedSession);
        const signIn = vi.fn();
        const authService = createAuthService({ initEmbeddedAuth, signIn });
        renderAuthGate(authService);

        expect(await screen.findByText("Authenticated app")).toBeInTheDocument();
        await waitFor(() => expect(initEmbeddedAuth).toHaveBeenCalledOnce());
        expect(signIn).not.toHaveBeenCalled();
        expect(screen.queryByRole("button", {
            name: "Sign in with Fabric",
        })).not.toBeInTheDocument();
    });
});
