//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { availableLocales, getLoadedLocale, loadStrings, setStrings, type AvailableLocale } from "@microsoft/fabric-visuals-core";
import { strings as englishStrings } from "@microsoft/fabric-visuals-core/localization/locales/en";

const SETTINGS_CHANNEL: string = "fabric-app-settings";
const SETTINGS_TIMEOUT_MS: number = 3_000;

function requestLanguage(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const host: Window = window.parent;
        const requestId: string = crypto.randomUUID();

        function cleanup(): void {
            window.removeEventListener("message", handleResponse);
            window.clearTimeout(timeoutId);
        }

        function handleResponse(event: MessageEvent<object | null>): void {
            const data: object | null = event.data;
            if (event.source !== host
                || typeof data !== "object" || data === null
                || !("channel" in data) || data.channel !== SETTINGS_CHANNEL
                || !("version" in data) || data.version !== 1
                || !("kind" in data) || data.kind !== "response"
                || !("requestId" in data) || data.requestId !== requestId) {
                return;
            }

            cleanup();
            if ("success" in data && data.success === true
                && !("error" in data && data.error)
                && "result" in data && typeof data.result === "object" && data.result !== null && !Array.isArray(data.result)
                && "currentLanguageLocale" in data.result && typeof data.result.currentLanguageLocale === "string"
                && data.result.currentLanguageLocale) {
                resolve(data.result.currentLanguageLocale);
            } else {
                reject(new Error("Fabric returned missing or invalid language settings.", {
                    cause: "error" in data ? data.error : undefined,
                }));
            }
        }

        const timeoutId: number = window.setTimeout(() => {
            cleanup();
            reject(new Error("Fabric language settings request timed out after three seconds."));
        }, SETTINGS_TIMEOUT_MS);

        try {
            window.addEventListener("message", handleResponse);
            // The parent can differ from the portal origin. This request has no credentials;
            // replies must match the parent window, request ID, channel, and version.
            host.postMessage({
                channel: SETTINGS_CHANNEL,
                version: 1,
                kind: "request",
                requestId,
                method: "settings.get",
                payload: {},
            }, "*");
        } catch (error) {
            cleanup();
            reject(error);
        }
    });
}

function resolveVisualLocale(language: string): AvailableLocale | undefined {
    let candidate: string = language.toLowerCase();
    while (candidate) {
        const locale: AvailableLocale | undefined = availableLocales.find(
            (available: AvailableLocale) => available.toLowerCase() === candidate,
        );
        if (locale) {
            return locale;
        }
        const separator: number = candidate.lastIndexOf("-");
        candidate = separator < 0 ? "" : candidate.slice(0, separator);
    }
    return undefined;
}

/** Initializes language in the background; failures warn and restore English. */
export async function bootstrapLanguage(): Promise<void> {
    try {
        const requestedLanguage: string = window.parent === window
            ? document.documentElement.lang || "en"
            : await requestLanguage();

        // Canonicalization validates the tag; availableLocales describes our actual translation bundles.
        const [language]: string[] = Intl.getCanonicalLocales(requestedLanguage);
        const locale: AvailableLocale | undefined = resolveVisualLocale(language);
        if (!locale) {
            throw new Error(`No visual translations for ${language}.`);
        }

        if (locale === "en") {
            setStrings("en", englishStrings);
        } else if (getLoadedLocale() !== locale) {
            await loadStrings(locale);
        }
        document.documentElement.lang = language;
    } catch (error) {
        console.warn("[Language] Could not initialize language; using English.", error);
        // English is bundled synchronously so the fallback also works when locale downloads fail.
        setStrings("en", englishStrings);
        document.documentElement.lang = "en";
    }
}
