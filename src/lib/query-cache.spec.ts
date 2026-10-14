//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { QueryErrorCategory } from "@microsoft/rayfin-connector-fabric-semanticmodel";
import {
    cachedQuery,
    cachePrefixKeyFor,
    clearCachedQueries,
    configureQueryCache,
    getQueryCacheConfig,
    getQueryCacheSize,
} from "@/lib/query-cache";

const success = {
    status: "success" as const,
    table: { columns: [{ name: "Value", dataType: "Int64" }], rows: [[1]] },
    requestId: "req-1",
};

// `Parameters<typeof cachedQuery>` would erase the generic to the structural
// minimum, dropping `requestId` from the result type. Bind it to the fixture.
type SuccessResult = typeof success;

function run(overrides: Partial<Parameters<typeof cachedQuery<SuccessResult>>[0]> = {}) {
    return cachedQuery<SuccessResult>({
        cachePrefixKey: "semanticModels.salesModel",
        query: "EVALUATE Sales",
        execute: vi.fn().mockResolvedValue(success),
        ...overrides,
    });
}

const semanticModelErrorCachePolicy: Record<QueryErrorCategory, boolean> = {
    api: false,
    query: true,
    network: false,
    overflow: false,
    unknown: false,
};

describe("query-cache", () => {
    beforeEach(() => {
        configureQueryCache({
            enabled: true,
            maxEntries: 256,
            isCacheableError: undefined,
        });
        clearCachedQueries();
    });

    it("executes on a miss and reports the result as fresh", async () => {
        const execute = vi.fn().mockResolvedValue(success);

        const result = await run({ execute });

        expect(execute).toHaveBeenCalledOnce();
        expect(result.fromCache).toBe(false);
        expect(result).toMatchObject({ status: "success", table: success.table });
        expect(getQueryCacheSize()).toBe(1);
    });

    it("serves a second identical call from cache with the original stored time", async () => {
        const execute = vi.fn().mockResolvedValue(success);

        await run({ execute });
        const second = await run({ execute });

        expect(execute).toHaveBeenCalledOnce();
        expect(second.fromCache).toBe(true);
        expect(second.cachedAt).toBeInstanceOf(Date);
        expect(second).toMatchObject({ status: "success", table: success.table });
    });

    it("prevents mutations through cache hits from corrupting the stored result", async () => {
        const execute = vi.fn().mockResolvedValue({
            ...success,
            table: { columns: [...success.table.columns], rows: [[1], [2]] },
        });

        await run({ execute });
        const firstHit = await run({ execute });

        expect(firstHit.fromCache).toBe(true);
        expect(Object.isFrozen(firstHit.table.rows)).toBe(true);
        expect(() => firstHit.table.rows.splice(0, 1)).toThrow(TypeError);

        const secondHit = await run({ execute });
        expect(secondHit.fromCache).toBe(true);
        expect(secondHit.table.rows).toEqual([[1], [2]]);
    });

    it("coalesces concurrent identical misses into one execution", async () => {
        let resolveExecution!: (value: typeof success) => void;
        const execute = vi.fn(
            () =>
                new Promise<typeof success>((resolve) => {
                    resolveExecution = resolve;
                }),
        );
        const duplicateExecute = vi.fn().mockResolvedValue(success);

        const first = run({ execute });
        const second = run({ execute: duplicateExecute });

        expect(execute).toHaveBeenCalledOnce();
        expect(duplicateExecute).not.toHaveBeenCalled();

        resolveExecution(success);
        const [firstResult, secondResult] = await Promise.all([first, second]);

        expect(firstResult).toMatchObject({ status: "success", fromCache: false });
        expect(secondResult).toEqual(firstResult);
        expect(getQueryCacheSize()).toBe(1);

        const cached = await run({ execute: duplicateExecute });
        expect(duplicateExecute).not.toHaveBeenCalled();
        expect(cached.fromCache).toBe(true);
    });

    it("executes bypass requests instead of joining a normal pending request", async () => {
        let resolvePending!: (value: typeof success) => void;
        const pendingExecute = vi.fn(
            () =>
                new Promise<typeof success>((resolve) => {
                    resolvePending = resolve;
                }),
        );
        const bypassResult = { ...success, requestId: "req-bypass" };
        const bypassExecute = vi.fn().mockResolvedValue(bypassResult);

        const pending = run({ execute: pendingExecute });
        const bypassed = await run({ execute: bypassExecute, bypassCache: true });

        expect(pendingExecute).toHaveBeenCalledOnce();
        expect(bypassExecute).toHaveBeenCalledOnce();
        expect(bypassed).toMatchObject({
            requestId: "req-bypass",
            fromCache: false,
        });

        resolvePending(success);
        await expect(pending).resolves.toMatchObject({
            requestId: "req-1",
            fromCache: false,
        });

        const unusedExecute = vi.fn().mockResolvedValue(success);
        await expect(run({ execute: unusedExecute })).resolves.toMatchObject({
            requestId: "req-bypass",
            fromCache: true,
        });
        expect(unusedExecute).not.toHaveBeenCalled();
    });

    it("propagates rejected executions without caching or poisoning later callers", async () => {
        const failure = new Error("transport failed");
        let rejectExecution!: (reason: Error) => void;
        const execute = vi.fn(
            () =>
                new Promise<typeof success>((_resolve, reject) => {
                    rejectExecution = reject;
                }),
        );
        const duplicateExecute = vi.fn().mockResolvedValue(success);

        const first = run({ execute });
        const second = run({ execute: duplicateExecute });

        expect(execute).toHaveBeenCalledOnce();
        expect(duplicateExecute).not.toHaveBeenCalled();

        rejectExecution(failure);
        await expect(first).rejects.toBe(failure);
        await expect(second).rejects.toBe(failure);
        expect(getQueryCacheSize()).toBe(0);

        const retried = await run({ execute: duplicateExecute });
        expect(duplicateExecute).toHaveBeenCalledOnce();
        expect(retried).toMatchObject({ status: "success", fromCache: false });
        expect(getQueryCacheSize()).toBe(1);
    });

    it("does not let a cleared pending query repopulate the cache", async () => {
        let resolvePending!: (value: typeof success) => void;
        const pendingExecute = vi.fn(
            () =>
                new Promise<typeof success>((resolve) => {
                    resolvePending = resolve;
                }),
        );
        const pending = run({ execute: pendingExecute });

        clearCachedQueries("semanticModels");

        const freshResult = { ...success, requestId: "req-fresh" };
        const freshExecute = vi.fn().mockResolvedValue(freshResult);
        await expect(run({ execute: freshExecute })).resolves.toMatchObject({
            requestId: "req-fresh",
            fromCache: false,
        });

        resolvePending({ ...success, requestId: "req-stale" });
        await expect(pending).resolves.toMatchObject({ requestId: "req-stale" });

        const unusedExecute = vi.fn().mockResolvedValue(success);
        await expect(run({ execute: unusedExecute })).resolves.toMatchObject({
            requestId: "req-fresh",
            fromCache: true,
        });
        expect(unusedExecute).not.toHaveBeenCalled();
    });

    it("does not let a cleared bypass query repopulate the cache either", async () => {
        let resolveBypass!: (value: typeof success) => void;
        const bypassExecute = vi.fn(
            () =>
                new Promise<typeof success>((resolve) => {
                    resolveBypass = resolve;
                }),
        );
        const bypassed = run({ execute: bypassExecute, bypassCache: true });

        clearCachedQueries("semanticModels");

        resolveBypass({ ...success, requestId: "req-stale" });
        await expect(bypassed).resolves.toMatchObject({ requestId: "req-stale" });

        expect(getQueryCacheSize()).toBe(0);
        const nextExecute = vi.fn().mockResolvedValue({ ...success, requestId: "req-next" });
        await expect(run({ execute: nextExecute })).resolves.toMatchObject({
            requestId: "req-next",
            fromCache: false,
        });
        expect(nextExecute).toHaveBeenCalledOnce();
    });

    it("keeps a bypass result private instead of serving it to a concurrent reader", async () => {
        let resolveBypass!: (value: typeof success) => void;
        const bypassExecute = vi.fn(
            () =>
                new Promise<typeof success>((resolve) => {
                    resolveBypass = resolve;
                }),
        );
        const bypassed = run({ execute: bypassExecute, bypassCache: true });

        const readerExecute = vi.fn().mockResolvedValue({ ...success, requestId: "req-reader" });
        const reader = run({ execute: readerExecute });

        resolveBypass({ ...success, requestId: "req-bypass" });

        await expect(bypassed).resolves.toMatchObject({ requestId: "req-bypass" });
        await expect(reader).resolves.toMatchObject({ requestId: "req-reader" });
        expect(readerExecute).toHaveBeenCalledOnce();
    });

    it("skips the read but still writes when bypassCache is set", async () => {
        const initialExecute = vi.fn().mockResolvedValue(success);
        const freshResult = { ...success, requestId: "req-fresh" };
        const bypassExecute = vi.fn().mockResolvedValue(freshResult);

        await run({ execute: initialExecute });
        expect(getQueryCacheSize()).toBe(1);

        const bypassed = await run({ execute: bypassExecute, bypassCache: true });
        expect(initialExecute).toHaveBeenCalledOnce();
        expect(bypassExecute).toHaveBeenCalledOnce();
        expect(bypassed).toMatchObject({
            requestId: "req-fresh",
            fromCache: false,
        });

        const unusedExecute = vi.fn().mockResolvedValue(success);
        const cached = await run({ execute: unusedExecute });
        expect(unusedExecute).not.toHaveBeenCalled();
        expect(cached.fromCache).toBe(true);
        expect(cached.requestId).toBe("req-fresh");
    });

    it.each([
        ["cachePrefixKey", { cachePrefixKey: "lakehouses.salesLake" }],
        ["query", { query: "EVALUATE Other" }],
        ["options", { options: { culture: "fr-FR" } }],
    ])("treats a different %s as a distinct cache entry", async (_label, overrides) => {
        const execute = vi.fn().mockResolvedValue(success);

        await run({ execute });
        const other = await run({ execute, ...overrides });

        expect(execute).toHaveBeenCalledTimes(2);
        expect(other.fromCache).toBe(false);
        expect(getQueryCacheSize()).toBe(2);
    });

    it("produces the same key regardless of option property order", async () => {
        const execute = vi.fn().mockResolvedValue(success);

        await run({ execute, options: { culture: "en-US", queryTimeout: 60 } });
        const second = await run({ execute, options: { queryTimeout: 60, culture: "en-US" } });

        expect(execute).toHaveBeenCalledOnce();
        expect(second.fromCache).toBe(true);
    });

    it("produces the same key regardless of nested option property order", async () => {
        const execute = vi.fn().mockResolvedValue(success);

        // `JSON.stringify` keeps insertion order, so an options object built
        // one way would otherwise miss the entry stored by the other.
        await run({ execute, options: { filter: { region: "West", year: 2026 } } });
        const second = await run({ execute, options: { filter: { year: 2026, region: "West" } } });

        expect(execute).toHaveBeenCalledOnce();
        expect(second.fromCache).toBe(true);
    });

    it("keeps array option order significant", async () => {
        const execute = vi.fn().mockResolvedValue(success);

        // Order carries meaning in a list of sort columns, so these are two
        // different queries and must not share one entry.
        await run({ execute, options: { orderBy: ["region", "year"] } });
        const second = await run({ execute, options: { orderBy: ["year", "region"] } });

        expect(execute).toHaveBeenCalledTimes(2);
        expect(second.fromCache).toBe(false);
    });

    it("refuses circular options rather than giving them an unstable key", async () => {
        const execute = vi.fn().mockResolvedValue(success);
        const circular: Record<string, unknown> = { culture: "en-US" };
        circular.self = circular;

        await expect(run({ execute, options: circular })).rejects.toThrow(/circular/i);
        expect(execute).not.toHaveBeenCalled();
    });

    it("keeps a prefix segment containing a dot out of its parent namespace", async () => {
        const execute = vi.fn().mockResolvedValue(success);
        const dotted = cachePrefixKeyFor("semanticModels", "sales.model");

        await run({ execute, cachePrefixKey: dotted });

        // "semanticModels.sales" names no connector, so clearing it must not
        // reach a connector that merely happens to be named "sales.model".
        clearCachedQueries("semanticModels.sales");
        expect(getQueryCacheSize()).toBe(1);

        clearCachedQueries(dotted);
        expect(getQueryCacheSize()).toBe(0);
    });

    it("keeps a name that spells the dot escape distinct from one with a real dot", async () => {
        // Escaping `%` first is what makes the encoding reversible. Without it
        // "a%2Eb" and "a.b" would collide on one key and clear each other.
        const literal = cachePrefixKeyFor("semanticModels", "a%2Eb");
        const dotted = cachePrefixKeyFor("semanticModels", "a.b");
        expect(literal).not.toBe(dotted);

        await run({ execute: vi.fn().mockResolvedValue(success), cachePrefixKey: literal });
        await run({ execute: vi.fn().mockResolvedValue(success), cachePrefixKey: dotted });
        expect(getQueryCacheSize()).toBe(2);

        clearCachedQueries(dotted);
        expect(getQueryCacheSize()).toBe(1);
    });

    it("detaches in-flight queries when a resize replaces the store", async () => {
        let release: (value: typeof success) => void = () => {};
        const first = vi.fn().mockReturnValue(
            new Promise<typeof success>((resolve) => {
                release = resolve;
            }),
        );
        const second = vi.fn().mockResolvedValue(success);

        const inFlight = run({ execute: first });
        configureQueryCache({ maxEntries: 8 });

        // The store those entries were destined for is gone, so a new caller
        // must start its own work rather than join the discarded run.
        const after = run({ execute: second });
        release(success);

        await expect(inFlight).resolves.toMatchObject({ status: "success" });
        await expect(after).resolves.toMatchObject({ status: "success" });
        expect(first).toHaveBeenCalledOnce();
        expect(second).toHaveBeenCalledOnce();
    });

    it.each(Object.entries(semanticModelErrorCachePolicy))(
        "applies the default semantic-model error cache policy for %s errors",
        async (category, shouldCache) => {
            const errorResult = {
                status: "error" as const,
                error: { category, message: `${category} failure` },
                requestId: `req-${category}`,
            };
            const firstExecute = vi.fn().mockResolvedValue(errorResult);
            const repeatExecute = vi.fn().mockResolvedValue(success);

            await run({ execute: firstExecute, query: `${category} DAX` });
            const repeat = await run({ execute: repeatExecute, query: `${category} DAX` });

            expect(firstExecute).toHaveBeenCalledOnce();
            if (shouldCache) {
                expect(repeatExecute).not.toHaveBeenCalled();
                expect(repeat).toMatchObject({ ...errorResult, fromCache: true });
            } else {
                expect(repeatExecute).toHaveBeenCalledOnce();
                expect(repeat).toMatchObject({ status: "success", fromCache: false });
            }
        },
    );

    it("uses the configured source-specific error cache predicate", async () => {
        configureQueryCache({ isCacheableError: (error) => error.category === "source-stable" });
        const sourceStableError = {
            status: "error" as const,
            error: { category: "source-stable", message: "Source says this is stable" },
            requestId: "req-2",
        };
        const queryError = {
            status: "error" as const,
            error: { category: "query", message: "Invalid DAX" },
            requestId: "req-3",
        };

        await run({ execute: vi.fn().mockResolvedValue(sourceStableError), query: "STABLE" });
        await run({ execute: vi.fn().mockResolvedValue(queryError), query: "QUERY" });

        expect(getQueryCacheSize()).toBe(1);

        const unusedStableExecute = vi.fn().mockResolvedValue(success);
        await expect(run({ execute: unusedStableExecute, query: "STABLE" })).resolves.toMatchObject({
            status: "error",
            error: { category: "source-stable" },
            fromCache: true,
        });
        expect(unusedStableExecute).not.toHaveBeenCalled();

        const retriedQueryExecute = vi.fn().mockResolvedValue(success);
        await expect(run({ execute: retriedQueryExecute, query: "QUERY" })).resolves.toMatchObject({
            status: "success",
            fromCache: false,
        });
        expect(retriedQueryExecute).toHaveBeenCalledOnce();
    });

    it("preserves cache provenance reported by the layer below", async () => {
        const cachedAt = new Date("2024-01-01T00:00:00Z");
        const execute = vi.fn().mockResolvedValue({ ...success, fromCache: true, cachedAt });

        const result = await run({ execute });

        expect(result.fromCache).toBe(true);
        expect(result.cachedAt).toEqual(cachedAt);
    });

    it("does not replay the layer-below provenance on its own cache hits", async () => {
        const belowCachedAt = new Date("2024-01-01T00:00:00Z");
        const execute = vi
            .fn()
            .mockResolvedValue({ ...success, fromCache: true, cachedAt: belowCachedAt });

        await run({ execute });
        const hit = await run({ execute });

        expect(hit.fromCache).toBe(true);
        expect(hit.cachedAt).not.toEqual(belowCachedAt);
    });

    it("clears entries for one prefix key only", async () => {
        const execute = vi.fn().mockResolvedValue(success);

        await run({ execute, cachePrefixKey: "semanticModels.salesModel" });
        await run({ execute, cachePrefixKey: "semanticModels.financeModel" });
        expect(getQueryCacheSize()).toBe(2);

        clearCachedQueries("semanticModels.salesModel");

        expect(getQueryCacheSize()).toBe(1);
        const finance = await run({ execute, cachePrefixKey: "semanticModels.financeModel" });
        expect(finance.fromCache).toBe(true);
        const sales = await run({ execute, cachePrefixKey: "semanticModels.salesModel" });
        expect(sales.fromCache).toBe(false);
    });

    it("clears every prefix key nested beneath the one given", async () => {
        const execute = vi.fn().mockResolvedValue(success);

        await run({ execute, cachePrefixKey: "semanticModels.salesModel" });
        await run({ execute, cachePrefixKey: "semanticModels.financeModel" });
        await run({ execute, cachePrefixKey: "lakehouses.salesLake" });
        expect(getQueryCacheSize()).toBe(3);

        clearCachedQueries("semanticModels");

        expect(getQueryCacheSize()).toBe(1);
        const lake = await run({ execute, cachePrefixKey: "lakehouses.salesLake" });
        expect(lake.fromCache).toBe(true);
    });

    it("evicts the least recently used entry once maxEntries is exceeded", async () => {
        configureQueryCache({ maxEntries: 2 });
        const execute = vi.fn().mockResolvedValue(success);

        await run({ execute, query: "A" });
        await run({ execute, query: "B" });

        // Touch A so B becomes the least recently used.
        expect((await run({ execute, query: "A" })).fromCache).toBe(true);

        await run({ execute, query: "C" });

        expect(getQueryCacheSize()).toBe(2);
        expect((await run({ execute, query: "A" })).fromCache).toBe(true);
        expect((await run({ execute, query: "C" })).fromCache).toBe(true);
        expect((await run({ execute, query: "B" })).fromCache).toBe(false);
    });

    it("executes every time and stores nothing when disabled", async () => {
        configureQueryCache({ enabled: false });
        const execute = vi.fn().mockResolvedValue(success);

        await run({ execute });
        const second = await run({ execute });

        expect(execute).toHaveBeenCalledTimes(2);
        expect(second.fromCache).toBe(false);
        expect(getQueryCacheSize()).toBe(0);
    });

    it("preserves lower-layer cache provenance when disabled", async () => {
        configureQueryCache({ enabled: false });
        const cachedAt = new Date("2024-01-01T00:00:00Z");
        const execute = vi.fn().mockResolvedValue({ ...success, fromCache: true, cachedAt });

        const result = await run({ execute });

        expect(execute).toHaveBeenCalledOnce();
        expect(result.fromCache).toBe(true);
        expect(result.cachedAt).toEqual(cachedAt);
        expect(getQueryCacheSize()).toBe(0);
    });

    it.each([
        ["a cache miss", { bypassCache: false }],
        ["a bypassed read", { bypassCache: true }],
    ])("freezes the table it returns on %s", async (_label, overrides) => {
        const execute = vi.fn().mockResolvedValue({
            ...success,
            table: { columns: [{ name: "Value", dataType: "Int64" }], rows: [[1]] },
        });

        const result = await run({ execute, ...overrides });

        expect(Object.isFrozen(result.table.rows)).toBe(true);
        expect(() => result.table.rows.push([2])).toThrow(TypeError);
    });

    it("freezes results even when caching is disabled", async () => {
        // Otherwise an app developed with the cache off ships code that mutates
        // a table, and only fails once caching is on and the result is shared.
        configureQueryCache({ enabled: false });
        const execute = vi.fn().mockResolvedValue({
            ...success,
            table: { columns: [{ name: "Value", dataType: "Int64" }], rows: [[1]] },
        });

        const result = await run({ execute });

        expect(getQueryCacheSize()).toBe(0);
        expect(Object.isFrozen(result.table.rows)).toBe(true);
        expect(() => result.table.rows.push([2])).toThrow(TypeError);
    });

    it("leaves a thrown cause unfrozen, since the cache does not own it", async () => {
        configureQueryCache({ isCacheableError: () => true });
        const cause = new Error("transport failed") as Error & { detail?: string };
        const execute = vi.fn().mockResolvedValue({
            status: "error" as const,
            error: { category: "network" as const, message: "transport failed", cause },
        });

        await run({ execute: execute as never });

        expect(Object.isFrozen(cause)).toBe(false);
        expect(() => {
            cause.detail = "still writable";
        }).not.toThrow();
    });

    it("reports the effective configuration and defaults to a 256 entry cache", () => {
        expect(getQueryCacheConfig()).toMatchObject({ enabled: true, maxEntries: 256 });
        expect(getQueryCacheConfig().isCacheableError({ category: "query", message: "Invalid DAX" })).toBe(
            true,
        );
        expect(getQueryCacheConfig().isCacheableError({ category: "api", message: "Forbidden" })).toBe(
            false,
        );

        configureQueryCache({ maxEntries: 32 });
        expect(getQueryCacheConfig()).toMatchObject({ enabled: true, maxEntries: 32 });

        configureQueryCache({ enabled: false });
        expect(getQueryCacheConfig()).toMatchObject({ enabled: false, maxEntries: 32 });
    });
});
