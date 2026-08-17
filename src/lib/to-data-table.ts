//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import type { ColumnDef, DataTable } from "@microsoft/fabric-visuals-core";
import type { QueryTable } from "@microsoft/fabric-app-data";

/**
 * Dictionary keyed by the original column name from the DAX query result.
 * Each value holds the `ColumnDef` metadata for that column.
 */
export type ColumnMetadataMap = Record<string, ColumnDef>;

export interface RollupDataTables {
    bodyTable: DataTable;
    grandTotalTable: DataTable;
}

export interface RollupDataTableOptions {
    rollupFlagColumns: readonly string[];
    internalColumns?: readonly string[];
}

/**
 * Merges a raw SDK query table with static column metadata to produce
 * a `DataTable` that `VegaVisual` and `DataGrid` accept directly.
 *
 * @param queryTable - The `table` value from `CachedQueryResult` (SDK output).
 * @param columnMetadata - Metadata dictionary exported from the query barrel file,
 *                         keyed by the original column name.
 * @returns A `DataTable` with enriched `ColumnDef` entries and the original rows.
 *
 * @example
 * ```tsx
 * import { columnMetadata, query } from "@/queries/sales/revenue-by-region";
 * import { toDataTable } from "@/lib/to-data-table";
 *
 * const { data } = useSemanticModelQuery({ connection: "myModel", query });
 *
 * if (data?.status === "success") {
 *   const dataTable = toDataTable(data.table, columnMetadata);
 *   return <VegaVisual spec={vegaLiteSpec} data={dataTable} theme={theme} />;
 * }
 * ```
 */
export function toDataTable(
    queryTable: QueryTable,
    columnMetadata: ColumnMetadataMap,
): DataTable {
    const columns: ColumnDef[] = queryTable.columns.map((col) => {
        return columnMetadata[col.name] ?? { name: col.name };
    });

    return { columns, rows: queryTable.rows };
}

/**
 * Splits a rollup query result into DataGrid body and grand-total tables.
 * Rollup flags and other internal query columns are removed from emitted tables.
 */
export function toRollupDataTables(
    queryTable: QueryTable,
    columnMetadata: ColumnMetadataMap,
    options: RollupDataTableOptions,
): RollupDataTables {
    if (options.rollupFlagColumns.length === 0) {
        throw new Error("At least one rollup flag column is required.");
    }

    const columnIndexes = new Map(
        queryTable.columns.map((column, index) => [column.name, index]),
    );
    const rollupFlagIndexes = options.rollupFlagColumns.map((columnName) => {
        const index = columnIndexes.get(columnName);
        if (index === undefined) {
            throw new Error(`Rollup flag column "${columnName}" was not found.`);
        }
        return index;
    });
    for (const columnName of options.internalColumns ?? []) {
        if (!columnIndexes.has(columnName)) {
            throw new Error(`Internal column "${columnName}" was not found.`);
        }
    }
    const internalColumns = new Set([
        ...options.rollupFlagColumns,
        ...(options.internalColumns ?? []),
    ]);
    const outputIndexes = queryTable.columns
        .map((column, index) => ({ column, index }))
        .filter(({ column }) => !internalColumns.has(column.name));
    const bodyRows: unknown[][] = [];
    const grandTotalRows: unknown[][] = [];

    for (const row of queryTable.rows) {
        const flags = rollupFlagIndexes.map((index) => row[index]);
        if (flags.some((flag) => typeof flag !== "boolean")) {
            throw new Error("Rollup flag values must be boolean.");
        }

        const outputRow = outputIndexes.map(({ index }) => row[index]);
        if (flags.every((flag) => flag === true)) {
            grandTotalRows.push(outputRow);
        } else if (flags.every((flag) => flag === false)) {
            bodyRows.push(outputRow);
        } else {
            throw new Error("Subtotal rows are not supported.");
        }
    }

    if (grandTotalRows.length > 1) {
        throw new Error(
            `Expected at most one grand-total row, received ${grandTotalRows.length}.`,
        );
    }

    const outputColumns = outputIndexes.map(({ column }) => column);
    const bodyTable = toDataTable(
        { columns: outputColumns, rows: bodyRows },
        columnMetadata,
    );
    return {
        bodyTable,
        grandTotalTable: toDataTable(
            { columns: outputColumns, rows: grandTotalRows },
            columnMetadata,
        ),
    };
}
