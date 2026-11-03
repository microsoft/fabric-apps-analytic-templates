//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { splitRollupDataTable, toDataTable, toRollupDataTables } from "@/lib/to-data-table";
import type { ColumnMetadataMap } from "@/lib/to-data-table";
import type { ColumnDef, DataTable } from "@microsoft/fabric-visuals-core";
import type { QueryTable } from "@microsoft/rayfin-connector-fabric-semanticmodel";

describe("toDataTable", () => {
    const queryTable: QueryTable = {
        columns: [
            { name: "Products[Region]", dataType: "string" },
            { name: "[Total Revenue]", dataType: "number" },
        ],
        rows: [
            ["East", 100],
            ["West", 200],
        ],
    };

    it("merges column metadata with the query table columns", () => {
        const columnMetadata: ColumnMetadataMap = {
            "Products[Region]": { name: "ProductsRegion", displayName: "Region" },
            "[Total Revenue]": { name: "TotalRevenue", displayName: "Total Revenue", format: "$#,0.00" },
        };

        const result = toDataTable(queryTable, columnMetadata);

        expect(result.columns).toEqual([
            { name: "ProductsRegion", displayName: "Region" },
            { name: "TotalRevenue", displayName: "Total Revenue", format: "$#,0.00" },
        ]);
    });

    it("falls back to { name: col.name } for columns with no metadata entry", () => {
        const result = toDataTable(queryTable, {});

        expect(result.columns).toEqual([
            { name: "Products[Region]" },
            { name: "[Total Revenue]" },
        ]);
    });

    it("passes rows through unchanged", () => {
        const result = toDataTable(queryTable, {});

        expect(result.rows).toBe(queryTable.rows);
    });

    it("applies metadata to known columns and falls back for unknown ones", () => {
        const columnMetadata: ColumnMetadataMap = {
            "Products[Region]": { name: "ProductsRegion", displayName: "Region" },
        };

        const result = toDataTable(queryTable, columnMetadata);

        expect(result.columns[0]).toEqual({ name: "ProductsRegion", displayName: "Region" });
        expect(result.columns[1]).toEqual({ name: "[Total Revenue]" });
    });
});

describe("toRollupDataTables", () => {
    const columnMetadata: ColumnMetadataMap = {
        "Region[Name]": { name: "RegionName", displayName: "Region" },
        "[Revenue]": {
            name: "Revenue",
            displayName: "Revenue",
            format: "$#,0.00",
        },
        "[Customer Count]": {
            name: "CustomerCount",
            displayName: "Customer Count",
            format: "#,##0",
        },
    };

    it("partitions body and one grand-total row and removes rollup flags", () => {
        const queryTable: QueryTable = {
            columns: [
                { name: "Region[Name]", dataType: "string" },
                { name: "[IsGrandTotal]", dataType: "boolean" },
                { name: "[Revenue]", dataType: "number" },
                { name: "[Customer Count]", dataType: "number" },
            ],
            rows: [
                ["East", false, 100, 8],
                ["West", false, 80, 7],
                [null, true, 180, 12],
            ],
        };

        const result = toRollupDataTables(queryTable, columnMetadata, {
            rollupFlagColumns: ["[IsGrandTotal]"],
        });

        expect(result.bodyTable).toEqual({
            columns: [
                { name: "RegionName", displayName: "Region" },
                {
                    name: "Revenue",
                    displayName: "Revenue",
                    format: "$#,0.00",
                },
                {
                    name: "CustomerCount",
                    displayName: "Customer Count",
                    format: "#,##0",
                },
            ],
            rows: [
                ["East", 100, 8],
                ["West", 80, 7],
            ],
        });
        expect(result.grandTotalTable).toEqual({
            columns: result.bodyTable.columns,
            rows: [[null, 180, 12]],
        });
    });

    it("requires every configured rollup flag column", () => {
        const queryTable: QueryTable = {
            columns: [{ name: "[Revenue]", dataType: "number" }],
            rows: [[100]],
        };

        expect(() =>
            toRollupDataTables(queryTable, columnMetadata, {
                rollupFlagColumns: ["[IsGrandTotal]"],
            }),
        ).toThrow('Rollup flag column "[IsGrandTotal]" was not found.');
    });

    it("requires at least one rollup flag column", () => {
        expect(() =>
            toRollupDataTables(
                {
                    columns: [{ name: "[Revenue]", dataType: "number" }],
                    rows: [[100]],
                },
                columnMetadata,
                { rollupFlagColumns: [] },
            ),
        ).toThrow("At least one rollup flag column is required.");
    });

    it("requires every configured internal column", () => {
        const queryTable: QueryTable = {
            columns: [
                { name: "[IsGrandTotal]", dataType: "boolean" },
                { name: "[Revenue]", dataType: "number" },
            ],
            rows: [[true, 100]],
        };

        expect(() =>
            toRollupDataTables(queryTable, columnMetadata, {
                rollupFlagColumns: ["[IsGrandTotal]"],
                internalColumns: ["[InternalSortKey]"],
            }),
        ).toThrow('Internal column "[InternalSortKey]" was not found.');
    });

    it("returns an empty grand-total table when the query has no grand-total row", () => {
        const columns = [
            { name: "[IsGrandTotal]", dataType: "boolean" },
            { name: "[Revenue]", dataType: "number" },
        ];

        const result = toRollupDataTables(
            { columns, rows: [[false, 100]] },
            columnMetadata,
            { rollupFlagColumns: ["[IsGrandTotal]"] },
        );

        expect(result.bodyTable).toEqual({
            columns: [
                {
                    name: "Revenue",
                    displayName: "Revenue",
                    format: "$#,0.00",
                },
            ],
            rows: [[100]],
        });
        expect(result.grandTotalTable).toEqual({
            columns: result.bodyTable.columns,
            rows: [],
        });
    });

    it("returns empty tables when an empty result omits the rollup flag column", () => {
        const result = toRollupDataTables(
            { columns: [], rows: [] },
            columnMetadata,
            { rollupFlagColumns: ["[IsGrandTotal]"], internalColumns: ["[InternalSortKey]"] },
        );

        expect(result.bodyTable).toEqual({ columns: [], rows: [] });
        expect(result.grandTotalTable).toEqual({ columns: [], rows: [] });
    });

    it("removes rollup flag columns from an empty result that keeps its schema", () => {
        const result = toRollupDataTables(
            {
                columns: [
                    { name: "Region[Name]", dataType: "string" },
                    { name: "[IsGrandTotal]", dataType: "boolean" },
                    { name: "[Revenue]", dataType: "number" },
                ],
                rows: [],
            },
            columnMetadata,
            { rollupFlagColumns: ["[IsGrandTotal]"] },
        );

        expect(result.bodyTable).toEqual({
            columns: [
                { name: "RegionName", displayName: "Region" },
                { name: "Revenue", displayName: "Revenue", format: "$#,0.00" },
            ],
            rows: [],
        });
        expect(result.grandTotalTable).toEqual({ columns: result.bodyTable.columns, rows: [] });
    });

    it("rejects more than one grand-total row", () => {
        const columns = [
            { name: "[IsGrandTotal]", dataType: "boolean" },
            { name: "[Revenue]", dataType: "number" },
        ];

        expect(() =>
            toRollupDataTables(
                {
                    columns,
                    rows: [
                        [true, 100],
                        [true, 200],
                    ],
                },
                columnMetadata,
                { rollupFlagColumns: ["[IsGrandTotal]"] },
            ),
        ).toThrow("Expected at most one grand-total row, received 2.");
    });

    it("requires boolean rollup flag values", () => {
        expect(() =>
            toRollupDataTables(
                {
                    columns: [
                        { name: "[IsGrandTotal]", dataType: "boolean" },
                        { name: "[Revenue]", dataType: "number" },
                    ],
                    rows: [[null, 100]],
                },
                columnMetadata,
                { rollupFlagColumns: ["[IsGrandTotal]"] },
            ),
        ).toThrow("Rollup flag values must be boolean.");
    });

    it("rejects subtotal rows until DataGrid supports them", () => {
        const queryTable: QueryTable = {
            columns: [
                { name: "[YearTotal]", dataType: "boolean" },
                { name: "[MonthTotal]", dataType: "boolean" },
                { name: "[Revenue]", dataType: "number" },
            ],
            rows: [
                [false, false, 100],
                [false, true, 100],
                [true, true, 100],
            ],
        };

        expect(() =>
            toRollupDataTables(queryTable, columnMetadata, {
                rollupFlagColumns: ["[YearTotal]", "[MonthTotal]"],
            }),
        ).toThrow("Subtotal rows are not supported.");
    });
});

describe("splitRollupDataTable", () => {
    const regionColumn: ColumnDef = { name: "RegionName", displayName: "Region" };
    const grandTotalFlagColumn: ColumnDef = { name: "IsGrandTotal" };
    const revenueColumn: ColumnDef = {
        name: "Revenue",
        displayName: "Revenue",
        format: "$#,0.00",
    };
    const sortKeyColumn: ColumnDef = { name: "RegionSortKey" };

    function freezeDataTable(dataTable: DataTable): DataTable {
        dataTable.rows.forEach((row) => Object.freeze(row));
        Object.freeze(dataTable.rows);
        Object.freeze(dataTable.columns);
        return Object.freeze(dataTable);
    }

    it("partitions converted body and grand-total rows and keeps column metadata", () => {
        const dataTable: DataTable = freezeDataTable({
            columns: [regionColumn, grandTotalFlagColumn, revenueColumn, sortKeyColumn],
            rows: [
                ["East", false, 100, 2],
                ["West", false, 80, 1],
                [null, true, 180, null],
            ],
        });

        const result = splitRollupDataTable(dataTable, {
            rollupFlagColumns: ["IsGrandTotal"],
            internalColumns: ["RegionSortKey"],
        });

        expect(result.bodyTable).toEqual({
            columns: [
                { name: "RegionName", displayName: "Region" },
                { name: "Revenue", displayName: "Revenue", format: "$#,0.00" },
            ],
            rows: [
                ["East", 100],
                ["West", 80],
            ],
        });
        expect(result.grandTotalTable).toEqual({
            columns: result.bodyTable.columns,
            rows: [[null, 180]],
        });
        expect(result.bodyTable.columns[0]).toBe(regionColumn);
        expect(result.bodyTable.columns[1]).toBe(revenueColumn);
        expect(result.grandTotalTable.columns[1]).toBe(revenueColumn);
        expect(dataTable.rows[2]).toEqual([null, true, 180, null]);
    });

    it("returns an empty grand-total table when the result has no grand-total row", () => {
        const result = splitRollupDataTable(
            { columns: [grandTotalFlagColumn, revenueColumn], rows: [[false, 100]] },
            { rollupFlagColumns: ["IsGrandTotal"] },
        );

        expect(result.bodyTable.rows).toEqual([[100]]);
        expect(result.grandTotalTable).toEqual({ columns: [revenueColumn], rows: [] });
    });

    it("returns empty tables when an empty result omits the rollup flag column", () => {
        const result = splitRollupDataTable(
            { columns: [], rows: [] },
            { rollupFlagColumns: ["IsGrandTotal"], internalColumns: ["RegionSortKey"] },
        );

        expect(result.bodyTable).toEqual({ columns: [], rows: [] });
        expect(result.grandTotalTable).toEqual({ columns: [], rows: [] });
    });

    it("matches converted column names rather than raw query names", () => {
        expect(() =>
            splitRollupDataTable(
                { columns: [grandTotalFlagColumn, revenueColumn], rows: [[true, 100]] },
                { rollupFlagColumns: ["[IsGrandTotal]"] },
            ),
        ).toThrow('Rollup flag column "[IsGrandTotal]" was not found.');
    });

    it("requires at least one rollup flag column", () => {
        expect(() =>
            splitRollupDataTable(
                { columns: [revenueColumn], rows: [[100]] },
                { rollupFlagColumns: [] },
            ),
        ).toThrow("At least one rollup flag column is required.");
    });

    it("requires every configured internal column", () => {
        expect(() =>
            splitRollupDataTable(
                { columns: [grandTotalFlagColumn, revenueColumn], rows: [[true, 100]] },
                {
                    rollupFlagColumns: ["IsGrandTotal"],
                    internalColumns: ["RegionSortKey"],
                },
            ),
        ).toThrow('Internal column "RegionSortKey" was not found.');
    });

    it("requires boolean rollup flag values", () => {
        expect(() =>
            splitRollupDataTable(
                { columns: [grandTotalFlagColumn, revenueColumn], rows: [[null, 100]] },
                { rollupFlagColumns: ["IsGrandTotal"] },
            ),
        ).toThrow("Rollup flag values must be boolean.");
    });

    it("rejects subtotal rows until DataGrid supports them", () => {
        const dataTable: DataTable = {
            columns: [{ name: "YearTotal" }, { name: "MonthTotal" }, revenueColumn],
            rows: [
                [false, false, 100],
                [false, true, 100],
                [true, true, 100],
            ],
        };

        expect(() =>
            splitRollupDataTable(dataTable, {
                rollupFlagColumns: ["YearTotal", "MonthTotal"],
            }),
        ).toThrow("Subtotal rows are not supported.");
    });

    it("rejects more than one grand-total row", () => {
        expect(() =>
            splitRollupDataTable(
                {
                    columns: [grandTotalFlagColumn, revenueColumn],
                    rows: [
                        [true, 100],
                        [true, 200],
                    ],
                },
                { rollupFlagColumns: ["IsGrandTotal"] },
            ),
        ).toThrow("Expected at most one grand-total row, received 2.");
    });
});
