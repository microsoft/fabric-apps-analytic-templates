//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SemanticModelQueryResult } from "@microsoft/rayfin-connector-fabric-semanticmodel";
import { NetworkError, type WorkloadFailure } from "@microsoft/rayfin-lib";
import { executeQueryFactory, insertInteractionFilters } from "./query-factory";
import type { DataQuery } from "./query-factory";
import { clearCachedQueries } from "./query-cache";
import { isThrottlingError } from "./semantic-model-errors";

const executeQuery = vi.hoisted(() => vi.fn<() => Promise<SemanticModelQueryResult>>());
vi.mock("@/lib/rayfin-client", () => ({
    getRayfinClient: () => ({ connectors: { model: { executeQuery } } }),
}));
const factory: DataQuery = {
    connection: "model", query: 'EVALUATE ROW("Value", 1)',
    columnMetadata: { "[Value]": { name: "Value", format: "0" } },
};
beforeEach(() => {
    clearCachedQueries();
    executeQuery.mockReset();
});

describe("managed query factory execution", () => {
    it("shares the query cache while preserving the factory's metadata and raw model values", async () => {
        executeQuery.mockResolvedValue({
            status: "success", requestId: "query-1",
            table: { columns: [{ name: "[Value]", dataType: "Int64" }], rows: [[1]] },
        });
        expect(await executeQueryFactory(factory)).toEqual({
            columns: [{ name: "Value", format: "0" }], rows: [[1]],
        });
        await executeQueryFactory(factory);
        expect(executeQuery).toHaveBeenCalledTimes(1);
        await executeQueryFactory(factory, true);
        expect(executeQuery).toHaveBeenCalledTimes(2);
    });
    it("throws failed SDK results with the query error as the cause", async () => {
        executeQuery.mockResolvedValue({ status: "error", requestId: "query-2", error: { category: "query", code: "DaxError", message: "Invalid DAX" } });
        await expect(executeQueryFactory(factory)).rejects.toMatchObject({
            message: "Invalid DAX",
            cause: { category: "query", code: "DaxError", message: "Invalid DAX" },
        });
    });
    it("preserves the original thrown cause alongside normalized query diagnostics", async () => {
        const failure: Error = new Error("Transport failed");
        executeQuery.mockRejectedValue(failure);
        await expect(executeQueryFactory(factory)).rejects.toMatchObject({
            message: "Transport failed",
            category: "unknown", cause: failure,
        });
    });
    it.each([429, 500])("retains structured throttling diagnostics through the executor for HTTP %s without caching failure", async (httpStatus: number): Promise<void> => {
        const workload: WorkloadFailure = {
            errorCode: "WorkloadException", subErrorCode: "TooManyRequests", status: "Failed",
        };
        const failure: NetworkError = Object.assign(new NetworkError("Invocation failed", httpStatus, "InvocationFailure"), { workload });
        executeQuery.mockRejectedValue(failure);
        await expect(executeQueryFactory(factory)).rejects.toMatchObject({
            category: "api", code: "InvocationFailure", httpStatus, workload, cause: failure,
        });
        await executeQueryFactory(factory).then(
            (): never => { throw new Error("Expected a failed query."); },
            (error: Error): void => { expect(isThrottlingError(error)).toBe(true); },
        );
        executeQuery.mockResolvedValue({
            status: "success", requestId: "recovery",
            table: { columns: [{ name: "[Value]", dataType: "Int64" }], rows: [[2]] },
        });
        expect((await executeQueryFactory(factory)).rows).toEqual([[2]]);
        expect(executeQuery).toHaveBeenCalledTimes(3);
    });
});

describe("authored interaction-filter markers", () => {
    const marker: string = "/*FILTERS*/";
    const filter: string = 'TREATAS({ "$&,$$,A" }, \'Category\'[Name])';
    it("inserts every complete filter before grouped measures without interpreting replacement tokens", () => {
        const query: string = `EVALUATE SUMMARIZECOLUMNS('Category'[Name], ${marker}"Value", [Sales])`;
        expect(insertInteractionFilters(query, [filter, "FILTER(ALL('Date'[Year]), 'Date'[Year] > 2020)"], marker, "beforeMeasures"))
            .toBe(`EVALUATE SUMMARIZECOLUMNS('Category'[Name], ${filter},\n    FILTER(ALL('Date'[Year]), 'Date'[Year] > 2020),\n    "Value", [Sales])`);
        expect(insertInteractionFilters(query, [], marker, "beforeMeasures")).toBe(query.replace(marker, ""));
    });
    it("uses leading commas after ROW/columns-only table expressions, and removes an empty marker", () => {
        const query: string = `EVALUATE CALCULATETABLE(ROW("Value", [Sales])${marker})`;
        expect(insertInteractionFilters(query, [filter], marker, "afterTable"))
            .toBe(`EVALUATE CALCULATETABLE(ROW("Value", [Sales]),\n    ${filter})`);
        expect(insertInteractionFilters(query, [], marker, "afterTable")).toBe('EVALUATE CALCULATETABLE(ROW("Value", [Sales]))');
    });
    it("rejects missing/repeated markers and empty filter strings", () => {
        expect(() => insertInteractionFilters("EVALUATE ROW()", [], marker, "afterTable")).toThrow("exactly one");
        expect(() => insertInteractionFilters(`${marker}${marker}`, [], marker, "afterTable")).toThrow("exactly one");
        expect(() => insertInteractionFilters(marker, [" "], marker, "beforeMeasures")).toThrow("nonempty");
    });
});
