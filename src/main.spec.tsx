//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { useState, type ReactElement, type ReactNode } from "react";
import type { Root } from "react-dom/client";
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setStrings } from "@microsoft/fabric-visuals-core";
import { strings as englishStrings } from "@microsoft/fabric-visuals-core/localization/locales/en";
import { VisualContainer } from "@microsoft/fabric-visuals-extensibility";
import type { IAuthService } from "./services/rayfin-auth.service";

const mocks: {
    root: Root | undefined;
    bootstrapLanguage: ReturnType<typeof vi.fn<() => Promise<void>>>;
    initEmbeddedAuth: ReturnType<typeof vi.fn<IAuthService["initEmbeddedAuth"]>>;
    appError: Error | undefined;
} = vi.hoisted(() => ({
    root: undefined,
    bootstrapLanguage: vi.fn<() => Promise<void>>(),
    initEmbeddedAuth: vi.fn<IAuthService["initEmbeddedAuth"]>(),
    appError: undefined,
}));

vi.mock("./services/language.service", () => ({ bootstrapLanguage: mocks.bootstrapLanguage }));
vi.mock("./services/rayfin-auth.service", () => ({
    bootstrapAuth: () => ({ initEmbeddedAuth: mocks.initEmbeddedAuth, signIn: vi.fn() }),
}));
vi.mock("./App.tsx", () => ({
    default: function TestApp(): ReactElement {
        const [filter, setFilter] = useState<string>("");
        if (mocks.appError) throw mocks.appError;
        return (
            <main>
                <input aria-label="Filter" value={filter} onChange={(event) => setFilter(event.target.value)} />
                <VisualContainer header={{ title: "Dashboard" }} builtInActions={{ copyVisual: {} }} />
            </main>
        );
    },
}));
vi.mock("@microsoft/fabric-visuals", () => ({ useCssTheme: () => ({}) }));
vi.mock("./hooks/use-theme", () => ({
    useAppTheme: () => ({ isDark: false, toggleTheme: vi.fn() }),
}));
vi.mock("./components/auth-gate.component", () => ({
    AuthGate: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("react-dom/client", async (importOriginal) => {
    const original: typeof import("react-dom/client") = await importOriginal<typeof import("react-dom/client")>();
    return {
        ...original,
        createRoot: (...args: Parameters<typeof original.createRoot>): Root => {
            mocks.root = original.createRoot(...args);
            return mocks.root;
        },
    };
});

describe("app startup", () => {
    beforeEach(() => {
        vi.resetModules();
        mocks.bootstrapLanguage.mockReset().mockResolvedValue();
        mocks.initEmbeddedAuth.mockReset().mockResolvedValue(null);
        mocks.appError = undefined;
        setStrings("en", englishStrings);
        document.body.innerHTML = '<div id="root"></div>';
        document.documentElement.lang = "en";
    });

    afterEach(async () => {
        await act(async () => { mocks.root?.unmount(); });
        mocks.root = undefined;
        setStrings("en", englishStrings);
        vi.restoreAllMocks();
        vi.useRealTimers();
        document.body.innerHTML = "";
        document.documentElement.removeAttribute("lang");
    });

    it("renders immediately and applies late translations without restarting auth or losing input", async () => {
        vi.useFakeTimers();
        let completeLanguage!: () => void;
        const languageReady: Promise<void> = new Promise((resolve) => { completeLanguage = resolve; });
        mocks.bootstrapLanguage.mockReturnValue(languageReady);

        await act(async () => { await import("./main"); });

        const copyButton: HTMLElement = screen.getByRole("button", { name: "Copy" });
        const filter: HTMLElement = screen.getByRole("textbox", { name: "Filter" });
        expect(mocks.initEmbeddedAuth).toHaveBeenCalledOnce();
        fireEvent.change(filter, { target: { value: "Sweden" } });
        filter.focus();
        await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
        expect(filter).toHaveValue("Sweden");
        expect(copyButton).toHaveAccessibleName("Copy");

        await act(async () => {
            setStrings("en", { ...englishStrings, VisualContainer_Copy: "Kopiera" });
            document.documentElement.lang = "sv";
            completeLanguage();
            await languageReady;
        });

        expect(copyButton).toHaveAccessibleName("Kopiera");
        expect(copyButton).toHaveAttribute("title", "Kopiera");
        expect(screen.getByRole("textbox", { name: "Filter" })).toBe(filter);
        expect(filter).toHaveValue("Sweden");
        expect(filter).toHaveFocus();
        expect(mocks.initEmbeddedAuth).toHaveBeenCalledOnce();
        expect(mocks.bootstrapLanguage).toHaveBeenCalledOnce();
    });

    it("renders normally when language initialization falls back to English", async () => {
        await act(async () => { await import("./main"); });
        expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
        expect(document.documentElement).toHaveAttribute("lang", "en");
    });

    it("still shows application errors through the existing error boundary", async () => {
        mocks.appError = new Error("Dashboard failed");
        vi.spyOn(console, "error").mockImplementation(() => {});
        await act(async () => { await import("./main"); });
        expect(screen.getByRole("heading")).toHaveTextContent("Something went wrong");
        expect(screen.getByText("Dashboard failed")).toBeInTheDocument();
    });
});
