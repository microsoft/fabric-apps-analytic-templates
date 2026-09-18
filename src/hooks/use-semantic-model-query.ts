//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { useState, useEffect, useCallback, useRef } from "react";
import { toQueryResult } from "@microsoft/rayfin-connector-fabric-semanticmodel";
import type {
    QueryErrorCategory,
    SemanticModelQueryResult,
} from "@microsoft/rayfin-connector-fabric-semanticmodel";
import { getRayfinClient } from "@/lib/rayfin-client";
import { cachedQuery, cachePrefixKeyFor, clearCachedQueries, type CachedQueryResult } from "@/lib/query-cache";

type SemanticModelQueryError = Extract<SemanticModelQueryResult, { status: "error" }>["error"];

interface SemanticModelQueryErrorWithCause extends SemanticModelQueryError {
    cause?: unknown;
}

interface ErrorWithCause extends Error {
    cause?: unknown;
}

const queryErrorCategories: readonly QueryErrorCategory[] = [
    "api",
    "query",
    "network",
    "overflow",
    "unknown",
];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isQueryErrorCategory(value: unknown): value is QueryErrorCategory {
    return typeof value === "string" && queryErrorCategories.includes(value as QueryErrorCategory);
}

function getErrorSources(err: unknown): unknown[] {
    const sources = [err];

    if (isRecord(err)) {
        sources.push(err.error, err.cause);
    }

    return sources;
}

function getStringProperty(err: unknown, propertyNames: readonly string[]): string | undefined {
    for (const source of getErrorSources(err)) {
        if (!isRecord(source)) continue;

        for (const propertyName of propertyNames) {
            const value = source[propertyName];

            if (typeof value === "string" && value.length > 0) {
                return value;
            }
        }
    }

    return undefined;
}

function getStatusCode(err: unknown): number | undefined {
    for (const source of getErrorSources(err)) {
        if (!isRecord(source)) continue;

        for (const propertyName of ["httpStatus", "statusCode", "status"]) {
            const value = source[propertyName];

            if (typeof value === "number") {
                return value;
            }

            if (typeof value === "string" && /^\d+$/.test(value)) {
                return Number(value);
            }
        }
    }

    return undefined;
}

function getErrorCode(err: unknown): string | undefined {
    return (
        getStringProperty(err, ["code", "errorCode"]) ??
        (getStatusCode(err) !== undefined ? String(getStatusCode(err)) : undefined)
    );
}

function getErrorDetails(err: unknown): string | undefined {
    const details = getStringProperty(err, ["details", "body"]);
    const statusCode = getStatusCode(err);

    if (statusCode === undefined || getErrorCode(err) === String(statusCode)) {
        return details;
    }

    const statusDetail = `httpStatus=${statusCode}`;
    return details ? `${details}; ${statusDetail}` : statusDetail;
}

function getErrorRequestId(err: unknown): string | undefined {
    return getStringProperty(err, ["requestId", "clientRequestId", "activityId"]);
}

function getErrorMessage(err: unknown): string {
    if (err instanceof Error && err.message.length > 0) {
        return err.message;
    }

    const message = getStringProperty(err, ["message"]);
    if (message) {
        return message;
    }

    const statusCode = getStatusCode(err);
    if (statusCode !== undefined) {
        return `Power BI returned HTTP ${statusCode}.`;
    }

    return String(err);
}

function getErrorCategory(err: unknown): QueryErrorCategory {
    if (getErrorCode(err) === "UNKNOWN_CONNECTOR") {
        return "unknown";
    }

    for (const source of getErrorSources(err)) {
        if (isRecord(source) && isQueryErrorCategory(source.category)) {
            return source.category;
        }
    }

    const code = getErrorCode(err);
    if (code && /^(?:EAI_|ECONN|ENOTFOUND|ETIMEDOUT)/i.test(code)) {
        return "network";
    }

    const message = getErrorMessage(err).toLowerCase();
    if (err instanceof TypeError && (message.includes("fetch failed") || message.includes("failed to fetch"))) {
        return "network";
    }

    return getStatusCode(err) !== undefined ? "api" : "unknown";
}

/**
 * Fold a thrown transport failure into the result union.
 *
 * `connection` is the name this call asked for, which is the same name the SDK
 * could not resolve. Taking it from the call site rather than parsing it back
 * out of the SDK's message keeps this independent of that message's wording.
 */
function toThrownQueryResult(err: unknown, connection: string): SemanticModelQueryResult {
    const isUnknownConnector = getErrorCode(err) === "UNKNOWN_CONNECTOR";
    const error: SemanticModelQueryErrorWithCause = {
        category: getErrorCategory(err),
        message: isUnknownConnector
            ? `Unknown connector "${connection}". Connectors are declared in rayfin.yml and added with \`rayfin connector add\`.`
            : getErrorMessage(err),
        ...(getErrorCode(err) !== undefined ? { code: getErrorCode(err) } : {}),
        ...(getErrorDetails(err) !== undefined ? { details: getErrorDetails(err) } : {}),
        cause: err,
    };

    return {
        status: "error",
        error,
        requestId: getErrorRequestId(err) ?? "",
    };
}

function toError(message: string, cause?: unknown): Error {
    const error: ErrorWithCause = new Error(message);

    if (cause !== undefined) {
        error.cause = cause;
    }

    return error;
}

function getErrorCause(error: SemanticModelQueryError): unknown {
    return "cause" in error ? error.cause : undefined;
}

interface UseSemanticModelQueryOptions {
    /** Connector name from `rayfin.yml` (e.g., "salesModel"). */
    connection: string;
    /** DAX query string. */
    query: string;
    /** If true, skip reading from cache (still writes the fresh result). */
    bypassCache?: boolean;
}

interface UseSemanticModelQueryResult {
    data: CachedQueryResult<SemanticModelQueryResult> | undefined;
    isLoading: boolean;
    error: Error | undefined;
    refetch: () => Promise<void>;
}

/**
 * Runs one DAX query through the semantic model connector and normalizes the
 * response.
 *
 * The connector transport throws on transport, auth, and server failures,
 * whereas a query that reaches Power BI and fails there comes back as an
 * ordinary response carrying an error. Both are folded into the same
 * `SemanticModelQueryResult` union so callers only ever branch on `status`.
 */
async function executeSemanticModelQuery(
    connection: string,
    query: string,
): Promise<SemanticModelQueryResult> {
    try {
        const response = await getRayfinClient().connectors[connection].executeQuery({ query });
        return toQueryResult(response);
    } catch (err) {
        return toThrownQueryResult(err, connection);
    }
}

/**
 * React hook that executes a DAX query against a Power BI semantic model
 * through the `fabric-semanticmodel` connector. Results are cached by the
 * app-level query cache in `src/lib/query-cache.ts`, which is shared across
 * every data source.
 *
 * The connector name is declared in `rayfin.yml` (managed by
 * `rayfin connector add`). The connector's workspace and item are resolved
 * server-side, so the app never sends them.
 *
 * @example
 * // Basic usage
 * const { data, isLoading } = useSemanticModelQuery({
 *   connection: "salesModel",
 *   query: 'EVALUATE SUMMARIZE(Sales, Products[Name], "Total", SUM(Sales[Amount]))',
 * });
 *
 * if (data?.status === "success") {
 *   const table = data.table;
 *   // table.columns, table.rows
 * }
 *
 * @example
 * // Handling errors. The hook never throws. Every failure — a connector throw
 * // or a failure Power BI returned — arrives as `data.status === "error"` with
 * // full diagnostics, and its message is mirrored onto `error` for
 * // convenience. Branch on `status`; `error` is never the only signal.
 * if (data?.status === "error") {
 *   console.error(data.error.category, data.error.message);
 * }
 *
 * @example
 * // Checking cache status
 * if (data?.fromCache) {
 *   console.log(`Cached at ${data.cachedAt}`);
 * }
 *
 * @example
 * // Bypassing cache for fresh data
 * const { data } = useSemanticModelQuery({
 *   connection: "salesModel",
 *   query: 'EVALUATE ...',
 *   bypassCache: true,
 * });
 *
 * @remarks
 * If either `connection` or `query` is empty the hook stays idle: it does not
 * query, and `data`, `error`, and `isLoading` all stay falsy. That is deliberate,
 * so a query can wait on a value that is not resolved yet. A non-empty connector
 * name that the SDK cannot resolve returns an `"unknown"` error that points
 * back to `rayfin.yml` and `rayfin connector add`.
 *
 * Results are deep-frozen. Copy before sorting or otherwise reordering a table.
 *
 * `clearQueryCache()` does not re-render this hook — it clears what the next
 * query reads. Call `refetch()` to re-read now.
 */
export function useSemanticModelQuery(
    options: UseSemanticModelQueryOptions,
): UseSemanticModelQueryResult {
    const { connection, query, bypassCache } = options;
    const [data, setData] = useState<CachedQueryResult<SemanticModelQueryResult> | undefined>();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<Error | undefined>();
    const requestIdRef = useRef(0);

    const canExecute = Boolean(connection && query);

    const execute = useCallback(
        async (forceRefresh = false) => {
            const requestId = ++requestIdRef.current;
            const isLatestRequest = () => requestId === requestIdRef.current;

            if (!canExecute) {
                setData(undefined);
                setError(undefined);
                setIsLoading(false);
                return;
            }

            setIsLoading(true);
            setError(undefined);

            // `refetch()` means "get fresh data", so it skips the cache.
            const skipCache = Boolean(bypassCache) || forceRefresh;

            try {
                const result = await cachedQuery({
                    cachePrefixKey: cachePrefixKeyFor("semanticModels", connection),
                    query,
                    bypassCache: skipCache,
                    execute: () => executeSemanticModelQuery(connection, query),
                });

                if (!isLatestRequest()) return;

                setData(result);

                if (result.status === "error") {
                    setError(toError(result.error.message, getErrorCause(result.error)));
                }
            } catch (err) {
                if (!isLatestRequest()) return;

                setError(err instanceof Error ? err : new Error(String(err)));
            } finally {
                if (isLatestRequest()) {
                    setIsLoading(false);
                }
            }
        },
        [connection, query, bypassCache, canExecute],
    );

    useEffect(() => {
        void execute(); // eslint-disable-line react-hooks/set-state-in-effect
        return () => {
            requestIdRef.current += 1;
        };
    }, [execute]);

    const refetch = useCallback(() => execute(true), [execute]);

    return { data, isLoading, error, refetch };
}

/**
 * Clears cached semantic model query results.
 * Pass a connector name to clear a specific connection, or omit to clear
 * every semantic model connection.
 *
 * @example
 * clearQueryCache();              // clear every semantic model connection
 * clearQueryCache("salesModel");  // clear a specific connection
 */
export function clearQueryCache(connection?: string): void {
    clearCachedQueries(connection ? cachePrefixKeyFor("semanticModels", connection) : "semanticModels");
}
