//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import type { OpaqueSession } from "@microsoft/rayfin-auth";

import { AuthProvider } from "@/hooks/use-auth";
import { useAuth } from "@/hooks/auth.context";
import type { IAuthService } from "@/services/rayfin-auth.service";

const signedIn = { isAuthenticated: true } as OpaqueSession;

function makeService(overrides: Partial<IAuthService> = {}): IAuthService {
    return {
        initEmbeddedAuth: vi.fn().mockResolvedValue(null),
        signIn: vi.fn().mockResolvedValue(signedIn),
        ...overrides,
    };
}

/** Renders the provider's state and exposes a button that triggers signIn. */
function Probe() {
    const { isAuthenticated, isSigningIn, signInError, signIn } = useAuth();
    return (
        <div>
            <span data-testid="authed">{String(isAuthenticated)}</span>
            <span data-testid="signing">{String(isSigningIn)}</span>
            <span data-testid="error">{signInError?.message ?? "none"}</span>
            <button onClick={() => void signIn()}>go</button>
        </div>
    );
}

function renderProvider(service: IAuthService) {
    return render(
        <AuthProvider rayfinAuthService={service}>
            <Probe />
        </AuthProvider>,
    );
}

describe("AuthProvider", () => {
    it("settles unauthenticated when not embedded", async () => {
        renderProvider(makeService());

        await waitFor(() =>
            expect(screen.getByTestId("authed")).toHaveTextContent("false"),
        );
        expect(screen.getByTestId("error")).toHaveTextContent("none");
    });

    it("authenticates after a successful interactive sign-in", async () => {
        const service = makeService();
        renderProvider(service);

        await waitFor(() =>
            expect(screen.getByTestId("authed")).toHaveTextContent("false"),
        );

        await act(async () => {
            screen.getByRole("button", { name: "go" }).click();
        });

        expect(service.signIn).toHaveBeenCalledOnce();
        expect(screen.getByTestId("authed")).toHaveTextContent("true");
        expect(screen.getByTestId("signing")).toHaveTextContent("false");
    });

    it("keeps a failed sign-in out of the fatal error channel", async () => {
        const service = makeService({
            signIn: vi.fn().mockRejectedValue(new Error("broker tab was blocked")),
        });
        renderProvider(service);

        await waitFor(() =>
            expect(screen.getByTestId("authed")).toHaveTextContent("false"),
        );

        await act(async () => {
            screen.getByRole("button", { name: "go" }).click();
        });

        // The provider rethrows `error` to the ErrorBoundary. Routing an
        // interactive sign-in failure there would tear the whole app down, so a
        // user who cancels the broker tab could never retry. Assert the app is
        // still mounted and the message landed in `signInError` instead.
        expect(screen.getByTestId("error")).toHaveTextContent("broker tab was blocked");
        expect(screen.getByTestId("authed")).toHaveTextContent("false");
        expect(screen.getByTestId("signing")).toHaveTextContent("false");
    });

    it("clears a previous sign-in error when retrying", async () => {
        const signIn = vi
            .fn()
            .mockRejectedValueOnce(new Error("broker tab was blocked"))
            .mockResolvedValueOnce(signedIn);
        const service = makeService({ signIn });
        renderProvider(service);

        await waitFor(() =>
            expect(screen.getByTestId("authed")).toHaveTextContent("false"),
        );

        await act(async () => {
            screen.getByRole("button", { name: "go" }).click();
        });
        expect(screen.getByTestId("error")).toHaveTextContent("broker tab was blocked");

        await act(async () => {
            screen.getByRole("button", { name: "go" }).click();
        });

        expect(signIn).toHaveBeenCalledTimes(2);
        expect(screen.getByTestId("error")).toHaveTextContent("none");
        expect(screen.getByTestId("authed")).toHaveTextContent("true");
    });
});
