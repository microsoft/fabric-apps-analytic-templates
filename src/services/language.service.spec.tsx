//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLoadedLocale, getString, overrideLocaleLoaders, setStrings } from "@microsoft/fabric-visuals-core";
import { strings as englishStrings } from "@microsoft/fabric-visuals-core/localization/locales/en";
import { bootstrapLanguage } from "./language.service";

const REQUEST_ID: ReturnType<typeof crypto.randomUUID> = "00000000-0000-4000-8000-000000000001";
type LocaleModule = { strings: typeof englishStrings };
const restores: (() => void)[] = [];

// Keep service tests independent of the installed package's translation inventory.
vi.mock("@microsoft/fabric-visuals-core", async (importOriginal) => {
    const original: typeof import("@microsoft/fabric-visuals-core") = await importOriginal<typeof import("@microsoft/fabric-visuals-core")>();
    return { ...original, availableLocales: ["en", "sv", "pt-pt"] };
});

function reply(result: object | string | null | undefined, fields: object = {}, source: MessageEventSource = window.parent): void {
    window.dispatchEvent(new MessageEvent("message", {
        source,
        origin: "https://dailypbiabd.powerbi.com",
        data: { channel: "fabric-app-settings", version: 1, kind: "response", requestId: REQUEST_ID, success: true, result, ...fields },
    }));
}

function expectEnglish(): void {
    expect(document.documentElement.lang).toBe("en");
    expect(getLoadedLocale()).toBe("en");
    expect(getString("VisualContainer_Copy")).toBe("Copy");
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("using English"), expect.anything());
}

describe("bootstrapLanguage", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.documentElement.lang = "fr";
        setStrings("en", { ...englishStrings, VisualContainer_Copy: "Previous translation" });
        const loaders: Record<string, () => Promise<LocaleModule>> = {
            sv: async () => ({ strings: { ...englishStrings, VisualContainer_Copy: "Kopiera" } }),
            "pt-pt": async () => ({ strings: { ...englishStrings, VisualContainer_Copy: "Copiar" } }),
        };
        restores.push(overrideLocaleLoaders(loaders));
        const iframe: HTMLIFrameElement = document.createElement("iframe");
        document.body.appendChild(iframe);
        if (!iframe.contentWindow) throw new Error("Expected an iframe window.");
        vi.stubGlobal("parent", iframe.contentWindow);
        vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
        vi.spyOn(crypto, "randomUUID").mockReturnValue(REQUEST_ID);
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
        expect(vi.getTimerCount()).toBe(0);
        for (const restore of restores.reverse()) restore();
        restores.length = 0;
        setStrings("en", englishStrings);
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
        document.body.innerHTML = "";
        document.documentElement.removeAttribute("lang");
    });

    it.each([
        ["sv", "sv", "sv", "Kopiera"],
        ["SV-se", "sv-SE", "sv", "Kopiera"],
        ["pt-PT", "pt-PT", "pt-pt", "Copiar"],
    ])("maps %s to the available translations", async (input: string, language: string, locale: string, label: string) => {
        const pending: Promise<void> = bootstrapLanguage();
        expect(window.parent.postMessage).toHaveBeenCalledWith({
            channel: "fabric-app-settings", version: 1, kind: "request",
            requestId: REQUEST_ID, method: "settings.get", payload: {},
        }, "*");
        reply({ currentLanguageLocale: input, currentFormatLocale: "en-US" });
        await pending;
        expect(document.documentElement.lang).toBe(language);
        expect(getLoadedLocale()).toBe(locale);
        expect(getString("VisualContainer_Copy")).toBe(label);
        expect(console.warn).not.toHaveBeenCalled();
    });

    it("uses the document language without contacting a host when standalone", async () => {
        const postMessage = vi.mocked(window.parent.postMessage);
        vi.stubGlobal("parent", window);
        document.documentElement.lang = "sv";
        await bootstrapLanguage();
        expect(getString("VisualContainer_Copy")).toBe("Kopiera");
        expect(document.documentElement.lang).toBe("sv");
        expect(postMessage).not.toHaveBeenCalled();
    });

    it.each([undefined, null, [], "sv", {}, { currentLanguageLocale: "" }, { currentLanguageLocale: 42 },
        { currentLanguageLocale: "sv_SE" }, { currentLanguageLocale: "zz-ZZ" }])(
        "restores English for missing, invalid, or unsupported settings: %j",
        async (settings: object | string | null | undefined) => {
            const pending: Promise<void> = bootstrapLanguage();
            reply(settings);
            await pending;
            expectEnglish();
        },
    );

    it("restores English when the host rejects the request", async () => {
        const pending: Promise<void> = bootstrapLanguage();
        reply(undefined, { success: false, error: { code: "UNKNOWN_CHANNEL", message: "No settings plugin" } });
        await pending;
        expectEnglish();
    });

    it("ignores unrelated messages, then accepts only the correlated parent response", async () => {
        const settled = vi.fn<() => void>();
        const pending: Promise<void> = bootstrapLanguage().then(settled);
        const settings: object = { currentLanguageLocale: "sv" };
        reply(settings, {}, window);
        for (const fields of [{ channel: "other" }, { version: 2 }, { kind: "request" }, { requestId: "other" }]) {
            reply(settings, fields);
        }
        await vi.advanceTimersByTimeAsync(0);
        expect(settled).not.toHaveBeenCalled();
        reply(settings);
        await pending;
        expect(getString("VisualContainer_Copy")).toBe("Kopiera");
    });

    it("times out at three seconds for hosts without settings support and ignores late replies", async () => {
        const settled = vi.fn<() => void>();
        const removeListener = vi.spyOn(window, "removeEventListener");
        const pending: Promise<void> = bootstrapLanguage().then(settled);
        await vi.advanceTimersByTimeAsync(2_999);
        expect(settled).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await pending;
        expectEnglish();
        expect(removeListener).toHaveBeenCalledWith("message", expect.any(Function));
        reply({ currentLanguageLocale: "sv" });
        expect(getString("VisualContainer_Copy")).toBe("Copy");
    });

    it.each(["request ID", "postMessage", "canonicalization"])("falls back instead of rejecting when %s throws", async (failure: string) => {
        const fail = (): never => { throw new Error("Unexpected failure"); };
        if (failure === "request ID") vi.mocked(crypto.randomUUID).mockImplementation(fail);
        else if (failure === "postMessage") vi.mocked(window.parent.postMessage).mockImplementation(fail);
        else vi.spyOn(Intl, "getCanonicalLocales").mockImplementation(fail);
        const pending: Promise<void> = bootstrapLanguage();
        reply({ currentLanguageLocale: "sv" });
        await expect(pending).resolves.toBeUndefined();
        expectEnglish();
    });

    it("restores bundled English if a translation download fails, without downloading English", async () => {
        const englishLoader = vi.fn<() => Promise<LocaleModule>>().mockRejectedValue(new Error("Offline"));
        const loaders: Record<string, () => Promise<LocaleModule>> = {
            en: englishLoader,
            sv: async () => { throw new Error("Translation download failed"); },
        };
        restores.push(overrideLocaleLoaders(loaders));
        const pending: Promise<void> = bootstrapLanguage();
        reply({ currentLanguageLocale: "sv" });
        await pending;
        expectEnglish();
        expect(englishLoader).not.toHaveBeenCalled();
    });
});
