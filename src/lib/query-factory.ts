//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import type { DataTable } from "@microsoft/fabric-visuals-core";
import { querySemanticModel } from "@/hooks/use-semantic-model-query";
import { toDataTable } from "./to-data-table";
import type { ColumnMetadataMap } from "./to-data-table";

/** The query portion of the existing { connection, query, columnMetadata, vegaLiteSpec } factory result. */
export interface DataQuery {
    connection: string;
    query: string;
    columnMetadata: ColumnMetadataMap;
}

/**
 * Executes a factory through the same cache and error normalization as useSemanticModelQuery.
 * Failed results throw so a managed target loader publishes an error state. The thrown error's
 * `cause` is the query error, which carries its `category`, `code`, and any `workload` detail.
 */
export async function executeQueryFactory(factory: DataQuery, bypassCache = false): Promise<DataTable> {
    const result = await querySemanticModel(factory.connection, factory.query, bypassCache);
    if (result.status === "error") {
        throw new Error(result.error.message, { cause: result.error });
    }

    return toDataTable(result.table, factory.columnMetadata);
}

/** Replaces one explicitly authored argument marker in a DAX query string. */
export function insertInteractionFilters(
    query: string,
    filters: readonly string[],
    marker: string,
    position: "beforeMeasures" | "afterTable",
): string {
    if (marker.length === 0 || query.split(marker).length !== 2) {
        throw new Error("Expected exactly one authored interaction-filter insertion point.");
    }

    if (position !== "beforeMeasures" && position !== "afterTable") {
        throw new Error("An interaction-filter marker must specify its DAX argument position.");
    }

    if (filters.some(filter => filter.trim().length === 0)) {
        throw new Error("Interaction filters must be complete, nonempty DAX table-filter arguments.");
    }

    let argumentsText: string;
    if (filters.length === 0) {
        argumentsText = "";
    }
    else if (position === "beforeMeasures") {
        // beforeMeasures: no leading comma, just join filters and add trailing comma and newline
        argumentsText = `${filters.join(",\n    ")},\n    `;
    }
    else if (position === "afterTable") {
        // afterTable: add leading comma and newline, then join filters
        argumentsText = `,\n    ${filters.join(",\n    ")}`;
    }
    
    return query.replace(marker, () => argumentsText);
}
