//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { useState, useEffect, useCallback, useRef } from "react";
import type { SemanticModelQueryResult } from "@microsoft/rayfin-connector-fabric-semanticmodel";
import { ConnectorsError } from "@microsoft/rayfin-connectors";
import { NetworkError, SdkError, type WorkloadFailure } from "@microsoft/rayfin-lib";
import { getRayfinClient } from "@/lib/rayfin-client";
import { cachedQuery, cachePrefixKeyFor, clearCachedQueries, type CachedQueryResult } from "@/lib/query-cache";

type SemanticModelQueryError = Extract<SemanticModelQueryResult, { status: "error" }>["error"];

interface SemanticModelQueryErrorWithCause extends SemanticModelQueryError {
    /** Fabric workload failure detail carried by a `NetworkError`, when the response had one. */
    workload?: WorkloadFailure;
    cause?: unknown;
}

interface ErrorWithCause extends Error {
    cause?: unknown;
}

/**
 * `ConnectorsError` code for a connector name the client has no configuration for.
 * `@microsoft/rayfin-connectors` documents the code but does not export it as a constant.
 */
const UNKNOWN_CONNECTOR_CODE = "UNKNOWN_CONNECTOR";

function isUnknownConnectorError(err: unknown): boolean {
    return err instanceof ConnectorsError && err.code === UNKNOWN_CONNECTOR_CODE;
}

/** The fields of a query error that a thrown error determines. */
type ThrownErrorFields = Pick<SemanticModelQueryErrorWithCause, "category" | "message" | "code" | "workload">;

function messageOf(err: unknown): string {
    return err instanceof Error && err.message.length > 0 ? err.message : String(err);
}

/**
 * Map a thrown error to query-error fields. Thrown errors carry no `category`; only a
 * returned query result does, so it is derived from the SDK's error types:
 *
 * - `NetworkError` without a `status`: no response arrived (offline, DNS, CORS), so `network`.
 * - `NetworkError` with a `status`: the service answered with a failure, so `api`.
 * - `ConnectorsError` and any other `SdkError`: a client-side failure with a stable `code`.
 * - Anything else: `unknown`.
 */
function describeThrownError(err: unknown): ThrownErrorFields {
    if (err instanceof NetworkError) {
        const code = err.code ?? (err.status !== undefined ? String(err.status) : undefined);
        return {
            category: err.status === undefined ? "network" : "api",
            message: messageOf(err),
            ...(code !== undefined ? { code } : {}),
            ...(err.workload !== undefined ? { workload: err.workload } : {}),
        };
    }

    if (err instanceof SdkError) {
        return {
            category: "unknown",
            message: messageOf(err),
            ...(err.code !== undefined ? { code: err.code } : {}),
        };
    }

    return { category: "unknown", message: messageOf(err) };
}

/**
 * Fold a thrown transport failure into the result union.
 *
 * `connection` is the name this call asked for, which is the same name the SDK
 * could not resolve. Taking it from the call site rather than parsing it back
 * out of the SDK's message keeps this independent of that message's wording.
 */
function toThrownQueryResult(err: unknown, connection: string): SemanticModelQueryResult {
    const error: SemanticModelQueryErrorWithCause = {
        ...describeThrownError(err),
        ...(isUnknownConnectorError(err)
            ? {
                message: `Unknown connector "${connection}". Connectors are declared in rayfin.yml and added with \`npx rayfin connector add\`.`,
            }
            : {}),
        cause: err,
    };

    return { status: "error", error, requestId: "" };
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
 * Runs one DAX query through the semantic model connector.
 *
 * `executeQuery` resolves to a `SemanticModelQueryResult`; a query that reaches
 * Power BI and fails there comes back as a `status: "error"` result. The call can
 * still throw (transport, auth, and server failures on the deployed path, or an
 * unknown connector name). Those are folded into the same union so callers only
 * ever branch on `status`.
 */
async function executeSemanticModelQuery(
    connection: string,
    query: string,
): Promise<SemanticModelQueryResult> {
    try {
        return await getRayfinClient().connectors[connection].executeQuery({ query });
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
 * `npx rayfin connector add`). The connector's workspace and item are resolved
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
 * back to `rayfin.yml` and `npx rayfin connector add`.
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
