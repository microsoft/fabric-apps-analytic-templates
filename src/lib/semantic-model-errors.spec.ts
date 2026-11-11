//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { ConnectorsError } from "@microsoft/rayfin-connectors";
import { NetworkError, SdkError } from "@microsoft/rayfin-lib";
import type { WorkloadFailure } from "@microsoft/rayfin-lib";
import { getErrorCause, isThrottlingError, SemanticModelQueryError, toError, toThrownQueryResult } from "./semantic-model-errors";
import type { SemanticModelQueryFailure } from "./semantic-model-errors";

const throttleWorkload: WorkloadFailure = {
    errorCode: "WorkloadException", subErrorCode: "TooManyRequests", status: "Failed",
};

describe("semantic-model error normalization", () => {
    it.each([
        { thrown: new NetworkError("offline"), category: "network", code: undefined },
        { thrown: new NetworkError("unauthorized", 401), category: "api", code: "401" },
        { thrown: new NetworkError("throttled", 429, "Throttled"), category: "api", code: "Throttled" },
        { thrown: new SdkError("not configured", "NOT_CONFIGURED"), category: "unknown", code: "NOT_CONFIGURED" },
    ])("preserves $category diagnostics and original cause", ({ thrown, category, code }) => {
        const result = toThrownQueryResult(thrown, "sales");
        expect(result.status).toBe("error");
        if (result.status !== "error") throw new Error("Expected an error result");
        expect(result.error).toMatchObject({ category, message: thrown.message, ...(code ? { code } : {}) });
        expect(getErrorCause(result.error)).toBe(thrown);
        expect(toError(result.error.message, getErrorCause(result.error)).cause).toBe(thrown);
    });

    it("names the CLI registration fix without dropping the connector error code", () => {
        const thrown: ConnectorsError = new ConnectorsError("missing", "UNKNOWN_CONNECTOR");
        const result = toThrownQueryResult(thrown, "sales");
        if (result.status !== "error") throw new Error("Expected an error result");
        expect(result.error).toMatchObject({ category: "unknown", code: "UNKNOWN_CONNECTOR" });
        expect(result.error.message).toBe(
            'No connector named "sales". Check that the name matches rayfin/rayfin.yml, ' +
            'or add it with `npx rayfin connector add`.',
        );
        expect(getErrorCause(result.error)).toBe(thrown);
    });

    it("preserves Fabric workload diagnostics", () => {
        const workload: WorkloadFailure = { errorCode: "WorkloadException", subErrorCode: "Unauthorized", functionName: "executeQuery", status: "Failed" };
        const thrown: NetworkError = Object.assign(new NetworkError("failed", 403), { workload });
        const result = toThrownQueryResult(thrown, "sales");
        if (result.status !== "error") throw new Error("Expected an error result");
        expect(result.error).toMatchObject({ category: "api", code: "403", workload });
    });

    it("handles arbitrary JavaScript thrown values", () => {
        const result = toThrownQueryResult("failure", "sales");
        expect(result).toMatchObject({ status: "error", error: { category: "unknown", message: "failure", cause: "failure" } });
    });

    it.each([429, 500])("preserves structured throttling diagnostics for HTTP %s", (httpStatus: number): void => {
        const workload: WorkloadFailure = {
            errorCode: "WorkloadException", subErrorCode: "TooManyRequests", status: "Failed",
        };
        const thrown: NetworkError = Object.assign(new NetworkError("Invocation failed", httpStatus, "InvocationFailure"), { workload });
        const result = toThrownQueryResult(thrown, "sales");
        if (result.status !== "error") throw new Error("Expected an error result");
        const error: SemanticModelQueryError = new SemanticModelQueryError(result.error);
        expect(error).toMatchObject({ category: "api", code: "InvocationFailure", httpStatus, workload, cause: thrown });
        expect(isThrottlingError(error)).toBe(true);
    });
});

describe("semantic model query errors", () => {
    it("retains every available diagnostic and the original cause", (): void => {
        const cause: NetworkError = new NetworkError("Invocation failed", 500, "InvocationFailure");
        const failure: SemanticModelQueryFailure = {
            category: "api", message: "Invocation failed", code: "InvocationFailure",
            details: "Original response", recoveryHint: "Contact the administrator",
            workload: throttleWorkload, httpStatus: 500, cause,
        };
        const error: SemanticModelQueryError = new SemanticModelQueryError(failure);
        expect(error).toBeInstanceOf(Error);
        expect(error).toMatchObject(failure);
        expect(error.cause).toBe(cause);
        expect(error.workload).toBe(throttleWorkload);
    });

    it("keeps a returned failure as the cause when no thrown cause exists", (): void => {
        const failure: SemanticModelQueryFailure = { category: "query", message: "Invalid DAX", code: "DaxError" };
        expect(new SemanticModelQueryError(failure).cause).toBe(failure);
    });

    it("preserves non-Error causes without inspecting or replacing them", (): void => {
        expect(new SemanticModelQueryError({ category: "unknown", message: "Failed", cause: "original" }).cause).toBe("original");
        expect(new SemanticModelQueryError({ category: "unknown", message: "Failed", cause: null }).cause).toBeNull();
    });
});

describe("structured throttling detection", () => {
    it.each([
        { name: "HTTP 429", failure: { category: "api", message: "Failed", httpStatus: 429 } },
        { name: "coded HTTP 429", failure: { category: "api", message: "Failed", httpStatus: 429, code: "InvocationFailure" } },
        { name: "workload with HTTP 500", failure: { category: "api", message: "Failed", httpStatus: 500, workload: throttleWorkload } },
        { name: "workload without HTTP status", failure: { category: "api", message: "Failed", workload: throttleWorkload } },
    ] satisfies { name: string; failure: SemanticModelQueryFailure }[])("recognizes $name", ({ failure }): void => {
        expect(isThrottlingError(new SemanticModelQueryError(failure))).toBe(true);
    });

    it.each([
        { category: "api", message: "TooManyRequests HTTP 429", httpStatus: 500 },
        { category: "api", message: "Failed", code: "429" },
        { category: "api", message: "Too many requests", code: "PowerBIThrottled" },
        { category: "api", message: "Failed", workload: { errorCode: "WorkloadException" } },
        { category: "api", message: "Failed", workload: { subErrorCode: "TooManyRequests" } },
        { category: "api", message: "Failed", workload: { errorCode: "OtherException", subErrorCode: "TooManyRequests" } },
        { category: "api", message: "Forbidden", httpStatus: 403, workload: { errorCode: "WorkloadException", subErrorCode: "Unauthorized" } },
        { category: "network", message: "Failed to fetch" },
        { category: "query", message: "TooManyRequests" },
    ] satisfies SemanticModelQueryFailure[])("does not infer throttling from unrelated diagnostics %#", (failure): void => {
        expect(isThrottlingError(new SemanticModelQueryError(failure))).toBe(false);
    });

    it("recognizes SDK transport failures without treating arbitrary Error properties as transport status", (): void => {
        expect(isThrottlingError(new NetworkError("Failed", 429, "InvocationFailure"))).toBe(true);
        expect(isThrottlingError(Object.assign(new NetworkError("Failed", 500), { workload: throttleWorkload }))).toBe(true);
        expect(isThrottlingError(new NetworkError("TooManyRequests", 500))).toBe(false);
        expect(isThrottlingError(new NetworkError("Failed to fetch"))).toBe(false);
        expect(isThrottlingError(new SdkError("TooManyRequests", "429"))).toBe(false);
        expect(isThrottlingError(Object.assign(new Error("TooManyRequests"), { status: 429, workload: throttleWorkload }))).toBe(false);
        expect(isThrottlingError(undefined)).toBe(false);
    });
});
