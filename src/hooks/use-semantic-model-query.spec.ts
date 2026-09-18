//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSemanticModelQuery, clearQueryCache } from "@/hooks/use-semantic-model-query";
import { clearCachedQueries, configureQueryCache } from "@/lib/query-cache";

// Mock the Rayfin client module so tests run offline. The mock stands in for
// the connector transport, so it yields raw wire responses and the hook's own
// normalization is exercised rather than stubbed out.
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

/** A successful `executeQuery` response as the connector returns it. */
function successResponse(rows: Array<Record<string, unknown>> = [{ Value: 1 }], requestId = "req-1") {
    return {
        status: "Succeeded",
        output: { tables: [{ rows }], requestId },
        errors: [],
    };
}

/** A response carrying a per-query DAX error, which normalizes to category `query`. */
function queryErrorResponse(message: string) {
    return {
        status: "Succeeded",
        output: { tables: [], queryError: { message }, requestId: "req-1" },
        errors: [],
    };
}

/** A response with FuncSet-level errors, which take precedence over output. */
function responseErrorsResponse() {
    return {
        status: "Failed",
        output: { tables: [], requestId: "req-errors" },
        errors: [
            {
                message: JSON.stringify({
                    httpStatus: 429,
                    code: "PowerBIThrottled",
                    message: "Too many requests",
                }),
            },
        ],
    };
}

/** A response carrying a dataset-level error, which normalizes to category `api`. */
function responseErrorResponse() {
    return {
        status: "Succeeded",
        output: {
            tables: [],
            responseError: { code: "PowerBINotAuthorized", message: "Forbidden" },
            requestId: "req-response-error",
        },
        errors: [],
    };
}

/** A response carrying a table overflow error, which normalizes to category `overflow`. */
function overflowResponse() {
    return {
        status: "Succeeded",
        output: {
            tables: [
                {
                    rows: [{ Value: 1 }],
                    error: { code: "ResultTruncated", message: "More than 1 rows returned" },
                },
            ],
            requestId: "req-overflow",
        },
        errors: [],
    };
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
    return Object.assign(
        new Error(
            `Connector "${connection}" was accessed but has no configuration. ` +
                `Pass it via \`new RayfinClient({ connectors: { ${connection}: { connector: '<type>' } } })\`.`,
        ),
        { code: "UNKNOWN_CONNECTOR", name: "ConnectorsError" },
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

    it("normalizes a successful response into columns and row arrays", async () => {
        mockExecuteQuery.mockResolvedValue(successResponse([{ Value: 1 }]));

        const { result } = renderHook(() =>
            useSemanticModelQuery({ connection: "model", query: "EVALUATE ROW()" }),
        );

        await waitFor(() => expect(result.current.isLoading).toBe(false));

        expect(result.current.data).toMatchObject({
            status: "success",
            table: { columns: [{ name: "Value", dataType: "unknown" }], rows: [[1]] },
            requestId: "req-1",
            fromCache: false,
        });
        expect(result.current.error).toBeUndefined();
    });

    it("sends only the query, since the connector resolves its own target", async () => {
        mockExecuteQuery.mockResolvedValue(successResponse());

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
        mockExecuteQuery.mockResolvedValue(successResponse([{ Value: 1 }]));

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
        mockExecuteQuery.mockResolvedValue(queryErrorResponse("Invalid DAX"));

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
                message: "Unknown connector \"missingModel\". Connectors are declared in rayfin.yml and added with `rayfin connector add`.",
            },
            requestId: "",
        });
        expect(result.current.error?.message).toBe(
            "Unknown connector \"missingModel\". Connectors are declared in rayfin.yml and added with `rayfin connector add`.",
        );
        expect(errorOf(result.current.data).cause).toBe(thrown);
    });

    it.each([
        {
            name: "FuncSet errors array",
            response: responseErrorsResponse(),
            expected: {
                error: { category: "api", code: "PowerBIThrottled", message: "Too many requests" },
                requestId: "req-errors",
            },
        },
        {
            name: "responseError",
            response: responseErrorResponse(),
            expected: {
                error: { category: "api", code: "PowerBINotAuthorized", message: "Forbidden" },
                requestId: "req-response-error",
            },
        },
        {
            name: "overflow flag",
            response: overflowResponse(),
            expected: {
                error: { category: "overflow", code: "ResultTruncated", message: "More than 1 rows returned" },
                requestId: "req-overflow",
            },
        },
    ])("normalizes the $name wire shape into hook error state", async ({ response, expected }) => {
        mockExecuteQuery.mockResolvedValue(response);

        const { result } = renderHook(() =>
            useSemanticModelQuery({ connection: "model", query: "EVALUATE ROW()" }),
        );

        await waitFor(() => expect(result.current.isLoading).toBe(false));

        expect(result.current.data).toMatchObject({
            status: "error",
            ...expected,
        });
        expect(result.current.error?.message).toBe(expected.error.message);
    });

    it.each([
        {
            name: "network",
            thrown: Object.assign(new TypeError("fetch failed"), {
                cause: { code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND api.powerbi.com" },
            }),
            expected: {
                error: { category: "network", code: "ENOTFOUND", message: "fetch failed" },
                requestId: "",
            },
        },
        {
            name: "api",
            thrown: {
                category: "api",
                code: "PowerBIServiceUnavailable",
                message: "Service unavailable",
                requestId: "req-thrown",
                status: 503,
            },
            expected: {
                error: {
                    category: "api",
                    code: "PowerBIServiceUnavailable",
                    details: "httpStatus=503",
                    message: "Service unavailable",
                },
                requestId: "req-thrown",
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
        mockExecuteQuery.mockResolvedValue(successResponse());

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
        const olderQuery = createDeferred<ReturnType<typeof successResponse>>();
        const newerQuery = createDeferred<ReturnType<typeof successResponse>>();
        mockExecuteQuery.mockImplementation(({ query }: { query: string }) =>
            query === "EVALUATE OLDER" ? olderQuery.promise : newerQuery.promise,
        );

        const { result, rerender } = renderHook(
            ({ query }) => useSemanticModelQuery({ connection: "model", query }),
            { initialProps: { query: "EVALUATE OLDER" } },
        );

        rerender({ query: "EVALUATE NEWER" });

        await act(async () => {
            newerQuery.resolve(successResponse([{ Value: "newer" }], "req-newer"));
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
            olderQuery.resolve(successResponse([{ Value: "older" }], "req-older"));
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
        mockExecuteQuery.mockResolvedValue(successResponse([{ Value: 1 }]));

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
            table: { columns: [{ name: "Value", dataType: "unknown" }], rows: [[1]] },
        });
    });

    it("skips the cache when bypassCache is true", async () => {
        mockExecuteQuery.mockResolvedValue(successResponse());

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
        mockExecuteQuery.mockResolvedValue(successResponse());

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
        mockExecuteQuery.mockResolvedValue(successResponse());

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
        mockExecuteQuery.mockResolvedValue(successResponse());

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
        mockExecuteQuery.mockResolvedValue(successResponse());

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
