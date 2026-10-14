//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { ConnectorsError } from "@microsoft/rayfin-connectors";
import { NetworkError, SdkError, type WorkloadFailure } from "@microsoft/rayfin-lib";
import type { QueryError, SemanticModelQueryResult } from "@microsoft/rayfin-connector-fabric-semanticmodel";
import { useSemanticModelQuery, clearQueryCache } from "@/hooks/use-semantic-model-query";
import { clearCachedQueries, configureQueryCache } from "@/lib/query-cache";

// Mock the Rayfin client module so tests run offline. The mock stands in for
// the connector client, so it yields what `executeQuery` resolves to: a
// `SemanticModelQueryResult`, already normalized by the connector runtime's
// invoke middleware.
const mockExecuteQuery = vi.hoisted(() => vi.fn());

vi.mock("@/lib/rayfin-client", () => ({
    getRayfinClient: () => ({
        connectors: new Proxy(
            {},
            {
                get: () => ({ executeQuery: mockExecuteQuery }),
            },
        ),
    }),
}));

/** A successful `executeQuery` result as the connector returns it. */
function successResult(rows: unknown[][] = [[1]], requestId = "req-1"): SemanticModelQueryResult {
    return {
        status: "success",
        table: { columns: [{ name: "[Value]", dataType: "Int64" }], rows },
        requestId,
    };
}

/** A failed `executeQuery` result as the connector returns it. */
function errorResult(error: QueryError, requestId = "req-1"): SemanticModelQueryResult {
    return { status: "error", error, requestId };
}

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });

    return { promise, resolve, reject };
}

function unknownConnectorError(connection: string) {
    return new ConnectorsError(
        `Connector "${connection}" was accessed but has no configuration. ` +
            `Pass it via \`new RayfinClient({ connectors: { ${connection}: { connector: '<type>' } } })\`.`,
        "UNKNOWN_CONNECTOR",
    );
}

interface ErrorWithCause extends Error {
    cause?: unknown;
}

interface QueryErrorWithCause {
    cause?: unknown;
}

/**
 * Narrows hook data to its error arm, asserting the status on the way through
 * so a success result fails the test rather than silently yielding `undefined`.
 */
function errorOf(data: { status: string } | undefined): QueryErrorWithCause {
    expect(data?.status).toBe("error");
    return (data as unknown as { error: QueryErrorWithCause }).error;
}

describe("useSemanticModelQuery", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureQueryCache({ enabled: true, maxEntries: 256 });
        clearCachedQueries();
    });

    it("starts in the loading state", () => {
        mockExecuteQuery.mockReturnValue(new Promise(() => {})); // never resolves

        const { result } = renderHook(() =>
            useSemanticModelQuery({ connection: "model", query: "EVALUATE ROW()" }),
        );

        expect(result.current.isLoading).toBe(true);
        expect(result.current.data).toBeUndefined();
        expect(result.current.error).toBeUndefined();
    });

    it("returns the connector's result with its columns and row arrays", async () => {
        mockExecuteQuery.mockResolvedValue(successResult([[1]]));

        const { result } = renderHook(() =>
            useSemanticModelQuery({ connection: "model", query: "EVALUATE ROW()" }),
        );

        await waitFor(() => expect(result.current.isLoading).toBe(false));

        expect(result.current.data).toMatchObject({
            status: "success",
            table: { columns: [{ name: "[Value]", dataType: "Int64" }], rows: [[1]] },
            requestId: "req-1",
            fromCache: false,
        });
        expect(result.current.error).toBeUndefined();
    });

    it("sends only the query, since the connector resolves its own target", async () => {
        mockExecuteQuery.mockResolvedValue(successResult());

        const { result } = renderHook(() =>
            useSemanticModelQuery({ connection: "model", query: "EVALUATE ROW()" }),
        );
        await waitFor(() => expect(result.current.isLoading).toBe(false));

        expect(mockExecuteQuery).toHaveBeenCalledWith({ query: "EVALUATE ROW()" });
    });

    it.each([
        {
            name: "connector name",
            options: { connection: "", query: "EVALUATE ROW()" },
        },
        {
            name: "query",
            options: { connection: "model", query: "" },
        },
    ])("stays idle without querying when the $name is empty", async ({ options }) => {
        const { result } = renderHook(() => useSemanticModelQuery(options));

        await waitFor(() => expect(result.current.isLoading).toBe(false));

        expect(mockExecuteQuery).not.toHaveBeenCalled();
        expect(result.current.data).toBeUndefined();
        expect(result.current.error).toBeUndefined();
    });

    it("clears populated state when the query becomes empty", async () => {
        mockExecuteQuery.mockResolvedValue(successResult([[1]]));

        const { result, rerender } = renderHook(
            ({ query }) => useSemanticModelQuery({ connection: "model", query }),
            { initialProps: { query: "EVALUATE ROW()" } },
        );

        await waitFor(() =>
            expect(result.current.data).toMatchObject({
                status: "success",
                table: { rows: [[1]] },
            }),
        );

        rerender({ query: "" });

        await waitFor(() => expect(result.current.data).toBeUndefined());
        expect(result.current.error).toBeUndefined();
        expect(result.current.isLoading).toBe(false);
    });

    it("exposes a DAX error as an error result rather than throwing", async () => {
        mockExecuteQuery.mockResolvedValue(errorResult({ category: "query", message: "Invalid DAX" }));

        const { result } = renderHook(() =>
            useSemanticModelQuery({ connection: "model", query: "EVALUATE Nope" }),
        );

        await waitFor(() => expect(result.current.isLoading).toBe(false));

        expect(result.current.data).toMatchObject({
            status: "error",
            error: { category: "query", message: "Invalid DAX" },
        });
        expect(result.current.error?.message).toBe("Invalid DAX");
    });

    it("returns an actionable error when the connector name is not configured", async () => {
        const thrown = unknownConnectorError("missingModel");
        mockExecuteQuery.mockRejectedValue(thrown);

        const { result } = renderHook(() =>
            useSemanticModelQuery({ connection: "missingModel", query: "EVALUATE ROW()" }),
        );

        await waitFor(() => expect(result.current.isLoading).toBe(false));

        expect(mockExecuteQuery).toHaveBeenCalledWith({ query: "EVALUATE ROW()" });
        expect(result.current.data).toMatchObject({
            status: "error",
            error: {
                category: "unknown",
                code: "UNKNOWN_CONNECTOR",
                message: "Unknown connector \"missingModel\". Connectors are declared in rayfin.yml and added with `npx rayfin connector add`.",
            },
            requestId: "",
        });
        expect(result.current.error?.message).toBe(
            "Unknown connector \"missingModel\". Connectors are declared in rayfin.yml and added with `npx rayfin connector add`.",
        );
        expect(errorOf(result.current.data).cause).toBe(thrown);
    });

    it.each([
        {
            name: "throttled api",
            response: errorResult(
                { category: "api", code: "PowerBIThrottled", message: "Too many requests" },
                "req-errors",
            ),
            expected: {
                error: { category: "api", code: "PowerBIThrottled", message: "Too many requests" },
                requestId: "req-errors",
            },
        },
        {
            name: "dataset-level api",
            response: errorResult(
                { category: "api", code: "PowerBINotAuthorized", message: "Forbidden" },
                "req-response-error",
            ),
            expected: {
                error: { category: "api", code: "PowerBINotAuthorized", message: "Forbidden" },
                requestId: "req-response-error",
            },
        },
        {
            // An overflow result carries no table: nothing partial comes back to render.
            name: "overflow",
            response: errorResult(
                {
                    category: "overflow",
                    message: 'Integer value 9007199254740993 in column "[Total]" exceeds Number.MAX_SAFE_INTEGER and cannot be safely represented.',
                },
                "req-overflow",
            ),
            expected: {
                error: {
                    category: "overflow",
                    message: 'Integer value 9007199254740993 in column "[Total]" exceeds Number.MAX_SAFE_INTEGER and cannot be safely represented.',
                },
                requestId: "req-overflow",
            },
        },
    ])("surfaces a $name error result as hook error state", async ({ response, expected }) => {
        mockExecuteQuery.mockResolvedValue(response);

        const { result } = renderHook(() =>
            useSemanticModelQuery({ connection: "model", query: "EVALUATE ROW()" }),
        );

        await waitFor(() => expect(result.current.isLoading).toBe(false));

        expect(result.current.data).toMatchObject({
            status: "error",
            ...expected,
        });
        expect(result.current.data).not.toHaveProperty("table");
        expect(result.current.error?.message).toBe(expected.error.message);
    });

    const workload: WorkloadFailure = {
        errorCode: "WorkloadException",
        subErrorCode: "Unauthorized",
        functionName: "executeQuery",
        status: "Failed",
    };

    it.each([
        {
            // The SDK wraps fetch's TypeError (offline, DNS, CORS) in a NetworkError with no status.
            name: "network",
            thrown: new NetworkError("Network error: Failed to fetch"),
            expected: {
                error: { category: "network", message: "Network error: Failed to fetch" },
                requestId: "",
            },
        },
        {
            // An HTTP failure response is a NetworkError carrying the status.
            name: "api",
            thrown: new NetworkError("HTTP Error 503: Service Unavailable", 503),
            expected: {
                error: { category: "api", code: "503", message: "HTTP Error 503: Service Unavailable" },
                requestId: "",
            },
        },
        {
            // A NetworkError's own code wins over its status.
            name: "coded api",
            thrown: new NetworkError("Too many requests", 429, "PowerBIThrottled"),
            expected: {
                error: { category: "api", code: "PowerBIThrottled", message: "Too many requests" },
                requestId: "",
            },
        },
        {
            name: "workload api",
            thrown: Object.assign(new NetworkError("The function invocation failed.", 502), { workload }),
            expected: {
                // Kept on the error itself, not only on `cause`.
                error: { category: "api", code: "502", message: "The function invocation failed.", workload },
                requestId: "",
            },
        },
        {
            // The connectors client wraps any non-SDK failure in this ConnectorsError.
            name: "unexpected connector",
            thrown: new ConnectorsError(
                "An unexpected error occurred during connector invocation: boom",
                "UNKNOWN_CONNECTOR_ERROR",
            ),
            expected: {
                error: {
                    category: "unknown",
                    code: "UNKNOWN_CONNECTOR_ERROR",
                    message: "An unexpected error occurred during connector invocation: boom",
                },
                requestId: "",
            },
        },
        {
            name: "SDK",
            thrown: new SdkError("SDK not configured.", "NOT_CONFIGURED"),
            expected: {
                error: { category: "unknown", code: "NOT_CONFIGURED", message: "SDK not configured." },
                requestId: "",
            },
        },
        {
            // A raw fetch TypeError never reaches the hook unwrapped, so it is not treated as `network`.
            name: "non-SDK",
            thrown: new TypeError("fetch failed"),
            expected: {
                error: { category: "unknown", message: "fetch failed" },
                requestId: "",
            },
        },
    ])("preserves diagnostics for a thrown $name failure", async ({ thrown, expected }) => {
        mockExecuteQuery.mockRejectedValue(thrown);

        const { result } = renderHook(() =>
            useSemanticModelQuery({ connection: "model", query: "EVALUATE ROW()" }),
        );

        await waitFor(() => expect(result.current.isLoading).toBe(false));

        expect(result.current.data).toMatchObject({
            status: "error",
            ...expected,
        });
        expect(errorOf(result.current.data).cause).toBe(thrown);
        expect((result.current.error as ErrorWithCause).cause).toBe(thrown);
    });

    it("maps a thrown non-SDK object to unknown without reading its properties", async () => {
        const thrown = { status: 503, code: "PowerBIServiceUnavailable", requestId: "req-thrown" };
        mockExecuteQuery.mockRejectedValue(thrown);

        const { result } = renderHook(() =>
            useSemanticModelQuery({ connection: "model", query: "EVALUATE ROW()" }),
        );

        await waitFor(() => expect(result.current.isLoading).toBe(false));

        expect(result.current.data).toMatchObject({ status: "error", error: { category: "unknown" }, requestId: "" });
        expect(errorOf(result.current.data)).not.toHaveProperty("code");
        expect(errorOf(result.current.data).cause).toBe(thrown);
    });

    it("does not cache a thrown transport failure, so the next render retries", async () => {
        mockExecuteQuery.mockRejectedValue(new Error("network down"));

        const first = renderHook(() =>
            useSemanticModelQuery({ connection: "model", query: "EVALUATE ROW()" }),
        );
        await waitFor(() => expect(first.result.current.isLoading).toBe(false));
        expect(mockExecuteQuery).toHaveBeenCalledTimes(1);

        const second = renderHook(() =>
            useSemanticModelQuery({ connection: "model", query: "EVALUATE ROW()" }),
        );
        await waitFor(() => expect(second.result.current.isLoading).toBe(false));

        expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
    });

    it("re-executes the query when refetch is called", async () => {
        mockExecuteQuery.mockResolvedValue(successResult());

        const { result } = renderHook(() =>
            useSemanticModelQuery({ connection: "model", query: "EVALUATE ROW()" }),
        );

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(mockExecuteQuery).toHaveBeenCalledTimes(1);

        await act(async () => {
            await result.current.refetch();
        });

        expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
    });

    it("ignores an older in-flight query when a newer query resolves first", async () => {
        const olderQuery = createDeferred<SemanticModelQueryResult>();
        const newerQuery = createDeferred<SemanticModelQueryResult>();
        mockExecuteQuery.mockImplementation(({ query }: { query: string }) =>
            query === "EVALUATE OLDER" ? olderQuery.promise : newerQuery.promise,
        );

        const { result, rerender } = renderHook(
            ({ query }) => useSemanticModelQuery({ connection: "model", query }),
            { initialProps: { query: "EVALUATE OLDER" } },
        );

        rerender({ query: "EVALUATE NEWER" });

        await act(async () => {
            newerQuery.resolve(successResult([["newer"]], "req-newer"));
            await newerQuery.promise;
        });

        await waitFor(() =>
            expect(result.current.data).toMatchObject({
                status: "success",
                table: { rows: [["newer"]] },
                requestId: "req-newer",
            }),
        );

        await act(async () => {
            olderQuery.resolve(successResult([["older"]], "req-older"));
            await olderQuery.promise;
        });

        expect(result.current.data).toMatchObject({
            status: "success",
            table: { rows: [["newer"]] },
            requestId: "req-newer",
        });
        expect(result.current.error).toBeUndefined();
        expect(result.current.isLoading).toBe(false);
    });

    it("serves a repeated query from the app-level cache without re-invoking the connector", async () => {
        mockExecuteQuery.mockResolvedValue(successResult([[1]]));

        const first = renderHook(() =>
            useSemanticModelQuery({ connection: "model", query: "EVALUATE ROW()" }),
        );
        await waitFor(() => expect(first.result.current.isLoading).toBe(false));
        expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
        expect(first.result.current.data?.fromCache).toBe(false);

        const second = renderHook(() =>
            useSemanticModelQuery({ connection: "model", query: "EVALUATE ROW()" }),
        );
        await waitFor(() => expect(second.result.current.isLoading).toBe(false));

        expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
        expect(second.result.current.data?.fromCache).toBe(true);
        expect(second.result.current.data).toMatchObject({
            status: "success",
            table: { columns: [{ name: "[Value]", dataType: "Int64" }], rows: [[1]] },
        });
    });

    it("skips the cache when bypassCache is true", async () => {
        mockExecuteQuery.mockResolvedValue(successResult());

        const first = renderHook(() =>
            useSemanticModelQuery({ connection: "model", query: "EVALUATE ROW()" }),
        );
        await waitFor(() => expect(first.result.current.isLoading).toBe(false));

        const second = renderHook(() =>
            useSemanticModelQuery({
                connection: "model",
                query: "EVALUATE ROW()",
                bypassCache: true,
            }),
        );
        await waitFor(() => expect(second.result.current.isLoading).toBe(false));

        expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
        expect(mockExecuteQuery).toHaveBeenLastCalledWith({ query: "EVALUATE ROW()" });
        expect(second.result.current.data?.fromCache).toBe(false);
    });

    it("caches the same query separately per connector name", async () => {
        mockExecuteQuery.mockResolvedValue(successResult());

        const first = renderHook(() =>
            useSemanticModelQuery({ connection: "salesModel", query: "EVALUATE ROW()" }),
        );
        await waitFor(() => expect(first.result.current.isLoading).toBe(false));

        const second = renderHook(() =>
            useSemanticModelQuery({ connection: "financeModel", query: "EVALUATE ROW()" }),
        );
        await waitFor(() => expect(second.result.current.isLoading).toBe(false));

        expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
        expect(second.result.current.data?.fromCache).toBe(false);
    });
});

describe("clearQueryCache", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureQueryCache({ enabled: true, maxEntries: 256 });
        clearCachedQueries();
    });

    it("clears every connection when called without an argument", async () => {
        mockExecuteQuery.mockResolvedValue(successResult());

        const sales = renderHook(() =>
            useSemanticModelQuery({ connection: "salesModel", query: "EVALUATE ROW()" }),
        );
        await waitFor(() => expect(sales.result.current.isLoading).toBe(false));

        const finance = renderHook(() =>
            useSemanticModelQuery({ connection: "financeModel", query: "EVALUATE ROW()" }),
        );
        await waitFor(() => expect(finance.result.current.isLoading).toBe(false));
        expect(mockExecuteQuery).toHaveBeenCalledTimes(2);

        act(() => {
            clearQueryCache();
        });

        const salesAgain = renderHook(() =>
            useSemanticModelQuery({ connection: "salesModel", query: "EVALUATE ROW()" }),
        );
        await waitFor(() => expect(salesAgain.result.current.isLoading).toBe(false));

        const financeAgain = renderHook(() =>
            useSemanticModelQuery({ connection: "financeModel", query: "EVALUATE ROW()" }),
        );
        await waitFor(() => expect(financeAgain.result.current.isLoading).toBe(false));

        expect(mockExecuteQuery).toHaveBeenCalledTimes(4);
        expect(salesAgain.result.current.data?.fromCache).toBe(false);
        expect(financeAgain.result.current.data?.fromCache).toBe(false);
    });

    it("leaves other connections cached when given a connector name", async () => {
        mockExecuteQuery.mockResolvedValue(successResult());

        const sales = renderHook(() =>
            useSemanticModelQuery({ connection: "salesModel", query: "EVALUATE ROW()" }),
        );
        await waitFor(() => expect(sales.result.current.isLoading).toBe(false));

        const finance = renderHook(() =>
            useSemanticModelQuery({ connection: "financeModel", query: "EVALUATE ROW()" }),
        );
        await waitFor(() => expect(finance.result.current.isLoading).toBe(false));
        expect(mockExecuteQuery).toHaveBeenCalledTimes(2);

        act(() => {
            clearQueryCache("salesModel");
        });

        const financeAgain = renderHook(() =>
            useSemanticModelQuery({ connection: "financeModel", query: "EVALUATE ROW()" }),
        );
        await waitFor(() => expect(financeAgain.result.current.isLoading).toBe(false));

        expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
        expect(financeAgain.result.current.data?.fromCache).toBe(true);
    });

    it("also drops app-level entries so the next render re-executes", async () => {
        mockExecuteQuery.mockResolvedValue(successResult());

        const first = renderHook(() =>
            useSemanticModelQuery({ connection: "salesModel", query: "EVALUATE ROW()" }),
        );
        await waitFor(() => expect(first.result.current.isLoading).toBe(false));
        expect(mockExecuteQuery).toHaveBeenCalledTimes(1);

        act(() => {
            clearQueryCache("salesModel");
        });

        const second = renderHook(() =>
            useSemanticModelQuery({ connection: "salesModel", query: "EVALUATE ROW()" }),
        );
        await waitFor(() => expect(second.result.current.isLoading).toBe(false));

        expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
        expect(second.result.current.data?.fromCache).toBe(false);
    });
});
