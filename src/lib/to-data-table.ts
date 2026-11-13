//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import type { ColumnDef, DataTable } from '@microsoft/fabric-visuals-core';

/**
 * The shape `toDataTable` reads from a query result: a raw table, before column
 * metadata is merged in.
 *
 * Composed from the `visuals-core` types rather than re-declaring their fields,
 * and narrowed to `name` because that is the only column property this reads -
 * everything else comes from `columnMetadata`. Declared here rather than
 * imported from `@microsoft/rayfin-connector-fabric-semanticmodel` so charting
 * does not drag the semantic-model connector in; that package's `QueryTable`
 * satisfies this structurally.
 */
export interface QueryTableLike {
    columns: readonly Pick<ColumnDef, 'name'>[];
    rows: DataTable['rows'];
}

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
 * Merges a raw connector query table with static column metadata to produce
 * a `DataTable` that `VegaVisual` and `DataGrid` accept directly.
 *
 * @param queryTable - The `table` value from a successful query result.
 * @param columnMetadata - Metadata dictionary exported from the query barrel file,
 *                         keyed by the original column name.
 * @returns A `DataTable` with enriched `ColumnDef` entries and the original rows.
 *
 * @remarks
 * `rows` is passed through by reference. Treat results as immutable and derive
 * a new array with `[...rows].sort(...)` rather than mutating in place.
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
    queryTable: QueryTableLike,
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
    queryTable: QueryTableLike,
    columnMetadata: ColumnMetadataMap,
    options: RollupDataTableOptions,
): RollupDataTables {
    const partition: RollupPartition<Pick<ColumnDef, "name">> = partitionRollupRows(
        queryTable.columns,
        queryTable.rows,
        options,
    );
    const bodyTable = toDataTable(
        { columns: partition.outputColumns, rows: partition.bodyRows },
        columnMetadata,
    );
    return {
        bodyTable,
        grandTotalTable: toDataTable(
            { columns: partition.outputColumns, rows: partition.grandTotalRows },
            columnMetadata,
        ),
    };
}

/**
 * Splits an already converted rollup `DataTable`, such as one returned by
 * `executeQueryFactory`, into DataGrid body and grand-total tables.
 *
 * @param dataTable - A converted table whose column names are the metadata `name` aliases.
 * @param options - Rollup flag and internal columns, named by their converted `ColumnDef.name`.
 * @returns Body and grand-total tables that keep the input `ColumnDef` entries,
 *          without the rollup flag and internal columns.
 */
export function splitRollupDataTable(
    dataTable: DataTable,
    options: RollupDataTableOptions,
): RollupDataTables {
    const partition: RollupPartition<ColumnDef> = partitionRollupRows(
        dataTable.columns,
        dataTable.rows,
        options,
    );

    return {
        bodyTable: { columns: partition.outputColumns, rows: partition.bodyRows },
        grandTotalTable: {
            columns: [...partition.outputColumns],
            rows: partition.grandTotalRows,
        },
    };
}

type DataRow = DataTable["rows"][number];

interface RollupPartition<TColumn> {
    outputColumns: TColumn[];
    bodyRows: DataRow[];
    grandTotalRows: DataRow[];
}

/**
 * Validates rollup flags and partitions rows into body and grand-total rows.
 * Emits new row arrays without flag and internal columns; input rows are not mutated.
 * A result with no rows, such as one filtered by an empty slicer selection,
 * yields empty body and grand-total tables.
 */
function partitionRollupRows<TColumn extends { readonly name: string }>(
    columns: readonly TColumn[],
    rows: readonly DataRow[],
    options: RollupDataTableOptions,
): RollupPartition<TColumn> {
    if (options.rollupFlagColumns.length === 0) {
        throw new Error("At least one rollup flag column is required.");
    }

    const internalColumns: Set<string> = new Set([
        ...options.rollupFlagColumns,
        ...(options.internalColumns ?? []),
    ]);
    const outputIndexes: { column: TColumn; index: number }[] = columns
        .map((column, index) => ({ column, index }))
        .filter(({ column }) => !internalColumns.has(column.name));

    // When filters exclude every row, the query service can return a schema
    // without the rollup flag and internal columns. There are no rows to
    // partition, so the configured columns are validated only for non-empty results.
    if (rows.length === 0) {
        return {
            outputColumns: outputIndexes.map(({ column }) => column),
            bodyRows: [],
            grandTotalRows: [],
        };
    }

    const columnIndexes: Map<string, number> = new Map(
        columns.map((column, index) => [column.name, index]),
    );
    const rollupFlagIndexes: number[] = options.rollupFlagColumns.map((columnName) => {
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
    const bodyRows: DataRow[] = [];
    const grandTotalRows: DataRow[] = [];

    for (const row of rows) {
        const flags = rollupFlagIndexes.map((index) => row[index]);
        if (flags.some((flag) => typeof flag !== "boolean")) {
            throw new Error("Rollup flag values must be boolean.");
        }

        const outputRow: DataRow = outputIndexes.map(({ index }) => row[index]);
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

    return {
        outputColumns: outputIndexes.map(({ column }) => column),
        bodyRows,
        grandTotalRows,
    };
}
