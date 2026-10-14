//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

/**
 * Session-lifetime query cache.
 *
 * Entries intentionally have no TTL and remain cached for the lifetime of the
 * app session. Callers use `bypassCache`/`refetch()` or
 * {@link clearCachedQueries} when they require fresher data.
 */

/**
 * The minimum shape the cache needs from a query result.
 *
 * Declared structurally rather than imported from any one data source, so the
 * cache stays source-agnostic. Every source the app talks to returns a
 * discriminated union on `status`; that is all the cache reads.
 */
export type CacheableQueryResult =
    | { status: "success" }
    | { status: "error"; error: { category: string; message: string } };

export type CacheableQueryError = Extract<CacheableQueryResult, { status: "error" }>["error"];

/**
 * A query result annotated with cache metadata.
 *
 * Caching is an app-level concern, so these two fields are added by
 * {@link cachedQuery} on the way back out rather than by the data layer.
 */
export type CachedQueryResult<T extends CacheableQueryResult = CacheableQueryResult> = T & {
    /** Whether this result was served from the cache. */
    fromCache: boolean;
    /** When the result was originally cached. Undefined when not from cache. */
    cachedAt?: Date;
};

/** Configuration for the app-level query cache. */
export interface QueryCacheConfig {
    /** Set to false to disable caching entirely. Default: true. */
    enabled?: boolean;
    /**
     * Maximum number of cached results. Default: 256.
     *
     * This bounds the entry *count*, not the memory they occupy, and entries
     * have no expiry: a result is retained until it is evicted, cleared, or the
     * page unloads. A query returning very wide or very long tables therefore
     * costs far more than one returning a single aggregate. Lower this if the
     * app browses large result sets over many filter permutations, since each
     * permutation is a distinct key.
     */
    maxEntries?: number;
    /** Predicate for cacheable error results. Default: cache only `"query"` category errors. */
    isCacheableError?: ((error: CacheableQueryError) => boolean) | undefined;
}

/** A stored cache entry. */
interface CacheEntry {
    result: CacheableQueryResult;
    cachedAt: Date;
    /** Prefix key this entry belongs to, used for scoped clears. */
    cachePrefixKey: string;
}

interface PendingQuery {
    promise: Promise<CachedQueryResult<CacheableQueryResult>>;
    cachePrefixKey: string;
    /**
     * False for `bypassCache` work. Such a query is tracked so that a clear can
     * still revoke its right to write, but a later caller must not be served
     * its result: the caller that asked to bypass the cache is the only one
     * that opted out of whatever is stored.
     */
    joinable: boolean;
}

const DEFAULT_MAX_ENTRIES = 256;

function defaultIsCacheableError(error: CacheableQueryError): boolean {
    return error.category === "query";
}

function matchesCachePrefix(cachePrefixKey: string, prefix: string): boolean {
    return cachePrefixKey === prefix || cachePrefixKey.startsWith(`${prefix}.`);
}

/**
 * Build a prefix key from namespace segments.
 *
 * `.` separates namespaces, so a segment that contains one would otherwise
 * invent a namespace boundary: a connector literally named `sales.model` would
 * be cleared by `clearCachedQueries("semanticModels.sales")`, which names a
 * connector that does not exist. Escaping `%` first keeps the encoding
 * reversible, so two different names can never produce one key.
 *
 * @example
 * cachePrefixKeyFor("semanticModels", connectorName);
 */
export function cachePrefixKeyFor(...segments: string[]): string {
    return segments.map((segment) => segment.split("%").join("%25").split(".").join("%2E")).join(".");
}

/**
 * In-memory LRU cache keyed by prefix key + query + options.
 *
 * Uses `Map` insertion order for LRU behavior: accessed entries are
 * re-inserted to move them to the end, and the oldest entry is evicted
 * once `maxEntries` is exceeded.
 */
class QueryCacheStore {
    private readonly map = new Map<string, CacheEntry>();

    constructor(private readonly maxEntries: number) {}

    get(key: string): CacheEntry | undefined {
        const entry = this.map.get(key);
        if (!entry) return undefined;

        // Move to end (most recently used).
        this.map.delete(key);
        this.map.set(key, entry);
        return entry;
    }

    set(key: string, entry: CacheEntry): void {
        // Delete first so a re-insert moves the entry to the end.
        this.map.delete(key);

        if (this.map.size >= this.maxEntries) {
            const oldest = this.map.keys().next().value;
            if (oldest !== undefined) this.map.delete(oldest);
        }

        this.map.set(key, entry);
    }

    /**
     * Remove every entry whose prefix key matches `prefix` exactly or sits
     * beneath it in the dotted namespace (e.g. `"semanticModels"` clears
     * `"semanticModels.salesModel"`).
     */
    clearPrefix(prefix: string): void {
        for (const [key, entry] of this.map) {
            if (matchesCachePrefix(entry.cachePrefixKey, prefix)) {
                this.map.delete(key);
            }
        }
    }

    clear(): void {
        this.map.clear();
    }

    get size(): number {
        return this.map.size;
    }
}

let config: Required<QueryCacheConfig> = {
    enabled: true,
    maxEntries: DEFAULT_MAX_ENTRIES,
    isCacheableError: defaultIsCacheableError,
};

let store = new QueryCacheStore(config.maxEntries);
const pendingQueries = new Map<string, PendingQuery>();

/**
 * Configure the app-level query cache.
 *
 * Call this once during app startup, before any query hook runs. Changing
 * `maxEntries` replaces the store, so any existing entries are dropped, and
 * in-flight queries are detached from the single-flight map with them: a
 * caller arriving after a reconfiguration must not be joined to work that was
 * started under the configuration that was just discarded.
 *
 * @example
 * configureQueryCache({ maxEntries: 512 });
 * configureQueryCache({ enabled: false }); // disable app-level caching
 */
export function configureQueryCache(next: QueryCacheConfig): void {
    const maxEntries = next.maxEntries ?? config.maxEntries;
    const enabled = next.enabled ?? config.enabled;
    const isCacheableError = Object.prototype.hasOwnProperty.call(next, "isCacheableError")
        ? next.isCacheableError ?? defaultIsCacheableError
        : config.isCacheableError;

    if (maxEntries !== config.maxEntries) {
        store = new QueryCacheStore(maxEntries);
        // Already-running queries still settle for the callers that started
        // them; they just no longer attract new ones.
        pendingQueries.clear();
    }

    config = { enabled, maxEntries, isCacheableError };
}

/** Returns the effective cache configuration. */
export function getQueryCacheConfig(): Required<QueryCacheConfig> {
    return { ...config };
}

/** Number of entries currently held. Exposed for diagnostics and tests. */
export function getQueryCacheSize(): number {
    return store.size;
}

/**
 * Serialize query options into a stable string for use as a cache key part.
 *
 * Keys are sorted and undefined values omitted so that option objects that
 * differ only in property order produce the same string. Sorting has to reach
 * nested objects too: `JSON.stringify` preserves their insertion order, so a
 * nested filter built in a different order would otherwise miss a cache entry
 * it should have hit. Arrays keep their order, which is meaningful.
 */
function serializeOptions(options?: Record<string, unknown>): string {
    if (!options) return "";
    return Object.keys(options)
        .sort()
        .filter((k) => options[k] !== undefined)
        .map((k) => `${k}=${stableStringify(options[k])}`)
        .join("&");
}

/** `JSON.stringify` with object keys sorted at every depth. */
function stableStringify(value: unknown, seen = new WeakSet<object>()): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value) ?? "null";
    }

    // A cycle cannot be given a stable key, and silently returning one would
    // make two different option objects collide. The mark is released on the
    // way out so the same object appearing twice side by side is still fine.
    if (seen.has(value)) {
        throw new TypeError("Query cache options must not contain circular references.");
    }
    seen.add(value);

    try {
        if (Array.isArray(value)) {
            return `[${value.map((item) => stableStringify(item, seen)).join(",")}]`;
        }

        const record = value as Record<string, unknown>;
        const body = Object.keys(record)
            .sort()
            .filter((key) => record[key] !== undefined)
            .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key], seen)}`)
            .join(",");
        return `{${body}}`;
    } finally {
        seen.delete(value);
    }
}

/**
 * Determine whether a query result should be cached.
 *
 * Successful results are stable for a given query, so they are cached.
 * Error results use the configured source-specific predicate.
 */
function isCacheable(result: CacheableQueryResult): boolean {
    if (result.status === "success") return true;
    return result.status === "error" && config.isCacheableError(result.error);
}

/** Strip cache metadata so a stored result carries only its own provenance. */
function stripCacheMetadata(result: CacheableQueryResult): CacheableQueryResult {
    const copy = { ...result } as Record<string, unknown>;
    delete copy.fromCache;
    delete copy.cachedAt;
    return copy as unknown as CacheableQueryResult;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) {
        return value;
    }

    // An `Error` reaching here is a `cause` carrying whatever the underlying
    // SDK threw. That object graph belongs to the SDK, not to the cache, so
    // freezing it could break code that never opted into this cache at all.
    if (value instanceof Error) {
        return value;
    }

    const objectValue = value as object;
    if (seen.has(objectValue)) {
        return value;
    }
    seen.add(objectValue);

    for (const child of Object.values(objectValue as Record<string, unknown>)) {
        deepFreeze(child, seen);
    }

    return Object.freeze(value) as T;
}

function withCacheProvenance<T extends CacheableQueryResult>(result: T): CachedQueryResult<T> {
    const below = result as CachedQueryResult<T>;
    return deepFreeze({
        ...result,
        fromCache: below.fromCache ?? false,
        cachedAt: below.cachedAt,
    } as CachedQueryResult<T>);
}

/** Arguments describing a single cacheable query execution. */
export interface CachedQueryArgs<T extends CacheableQueryResult> {
    /**
     * Namespace for this query, chosen by the calling app code.
     *
     * Use a dotted path that identifies the data source, for example
     * `"semanticModels.salesModel"`. The full cache key is built from this
     * prefix key plus the query text plus the serialized options, so two
     * sources can never collide on the same query text. The prefix is also
     * what {@link clearCachedQueries} matches against for scoped clears.
     */
    cachePrefixKey: string;
    /** The query text. */
    query: string;
    /** Source-specific query options that affect the result. */
    options?: Record<string, unknown>;
    /** If true, skip reading from cache. The fresh result is still written. */
    bypassCache?: boolean;
    /** Executes the query against the underlying data source. */
    execute: () => Promise<T>;
}

/**
 * Execute a query with cache-aside logic against the app-level cache.
 *
 * This sits above the individual query hooks, so a single cache serves every
 * data source the app talks to. The cache key is the caller supplied
 * `cachePrefixKey` plus the query text plus the serialized options. On a hit
 * the result is returned with `fromCache: true` and the time it was stored.
 *
 * Every result is deep-frozen on the way out, whether it came from the cache,
 * from a `bypassCache` call, or from a cache that is disabled entirely. Hits
 * hand out shared references, so one caller mutating a table in place would
 * corrupt what every later caller reads; freezing uniformly means code cannot
 * be written against a mutable result and then break on its second render.
 *
 * @throws Rejections from `execute` propagate to the caller and are not cached.
 *
 * @example
 * const result = await cachedQuery({
 *   cachePrefixKey: "semanticModels.salesModel",
 *   query: "EVALUATE Sales",
 *   execute: () => executeSemanticModelQuery("salesModel", "EVALUATE Sales"),
 * });
 */
export async function cachedQuery<T extends CacheableQueryResult>(
    args: CachedQueryArgs<T>,
): Promise<CachedQueryResult<T>> {
    const { cachePrefixKey, query, options, bypassCache, execute } = args;

    if (!config.enabled) {
        return withCacheProvenance(await execute());
    }

    const key = [cachePrefixKey, query, serializeOptions(options)].join("\0");

    if (!bypassCache) {
        const hit = store.get(key);
        if (hit) {
            return deepFreeze({
                ...(hit.result as T),
                fromCache: true,
                cachedAt: hit.cachedAt,
            });
        }

        const pendingEntry = pendingQueries.get(key);
        if (pendingEntry?.joinable) {
            return pendingEntry.promise as Promise<CachedQueryResult<T>>;
        }
    }

    const executeAndCache = async (shouldCache: () => boolean): Promise<CachedQueryResult<T>> => {
        const result = await execute();

        if (isCacheable(result) && shouldCache()) {
            store.set(key, {
                result: stripCacheMetadata(result),
                cachedAt: new Date(),
                cachePrefixKey,
            });
        }

        return withCacheProvenance(result);
    };

    // Both the shared and the bypass path register here, so a clear that lands
    // mid-flight revokes the right to write in exactly the same way for each:
    // the entry is gone, so the identity check below fails and nothing is
    // stored. `joinable` is what keeps a bypass result private to its caller.
    const pending: Promise<CachedQueryResult<T>> = executeAndCache(
        () => pendingQueries.get(key)?.promise === pending,
    ).finally(() => {
        if (pendingQueries.get(key)?.promise === pending) {
            pendingQueries.delete(key);
        }
    });
    pendingQueries.set(key, {
        promise: pending as Promise<CachedQueryResult<CacheableQueryResult>>,
        cachePrefixKey,
        joinable: !bypassCache,
    });
    return pending;
}

/**
 * Clear app-level cached results.
 *
 * Pass a cache prefix key to clear that namespace and everything beneath it
 * (`"semanticModels"` clears `"semanticModels.salesModel"`), or omit it to
 * clear everything. A query already in flight when the clear lands does not
 * repopulate the namespace it emptied; its caller still receives the result.
 *
 * This affects what the *next* query reads. The cache has no subscribers, so
 * components already holding a result keep rendering it: clearing is not a
 * refresh. To re-read, call the owning hook's `refetch()`, or change a value
 * the hook's inputs depend on. That is deliberate — a subscription model would
 * make every cache write a potential re-render of unrelated components.
 */
export function clearCachedQueries(cachePrefixKey?: string): void {
    if (cachePrefixKey) {
        store.clearPrefix(cachePrefixKey);
        for (const [key, pending] of pendingQueries) {
            if (matchesCachePrefix(pending.cachePrefixKey, cachePrefixKey)) {
                pendingQueries.delete(key);
            }
        }
    } else {
        store.clear();
        pendingQueries.clear();
    }
}
