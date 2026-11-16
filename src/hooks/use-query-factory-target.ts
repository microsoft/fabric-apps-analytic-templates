//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { useMemo, useState } from "react";
import type { DataTable } from "@microsoft/fabric-visuals-core";
import { createHighlightData } from "@microsoft/fabric-interaction-manager";
import type {
    InteractionTargetData,
    InteractionTargetLoadContext,
    InteractionTargetLoader,
    ManagedQueryFactoryParams,
    ManagedTargetLoadState,
} from "@microsoft/fabric-interaction-manager";
import { useManagedInteractionTarget } from "@microsoft/fabric-interaction-manager/react";
import { executeQueryFactory } from "@/lib/query-factory";
import type { DataQuery } from "@/lib/query-factory";

/** The `createHighlightData` settings that align a highlighted subset with its baseline. */
export interface HighlightAlignment {
    /** Every group and series key column, including hidden identifiers. */
    readonly groupingFields: readonly string[];
    /** The value for each measure column in baseline groups absent from the highlighted subset. */
    readonly missingMeasureReplacementValues: Readonly<Record<string, number | null>>;
    /** The measure columns the chart draws. */
    readonly plottedMeasureFields: readonly string[];
}

/** The baseline and aligned highlighted datasets of a highlight-capable target. */
export type HighlightData = {
    readonly all: DataTable;
    readonly highlighted: DataTable;
};

/** A managed target load state whose data has the shape this hook's loader returns. */
export type QueryFactoryTargetState<TData extends InteractionTargetData> = {
    // Preserve every manager state and its fields, narrowing only the loader's data shape.
    [TState in ManagedTargetLoadState as TState["status"]]: TState extends { readonly data: InteractionTargetData }
        ? Omit<TState, "data"> & { readonly data: TData }
        : TState;
}[ManagedTargetLoadState["status"]];

/**
 * Loads a managed interaction target from a query factory. The hook passes the target's baseline
 * filters to the factory and returns one table. With a highlight alignment, it also runs the factory
 * under the highlight filters during an active cross-highlight and returns `{ all, highlighted }`.
 * `params` are the factory's app inputs other than `interactionFilters`.
 */
export function useQueryFactoryTarget<TParams extends ManagedQueryFactoryParams>(
    targetId: string,
    factory: (params: TParams) => DataQuery,
    params: Omit<TParams, "interactionFilters">,
): QueryFactoryTargetState<DataTable>;
export function useQueryFactoryTarget<TParams extends ManagedQueryFactoryParams>(
    targetId: string,
    factory: (params: TParams) => DataQuery,
    params: Omit<TParams, "interactionFilters">,
    highlightAlignment: HighlightAlignment,
): QueryFactoryTargetState<HighlightData>;
export function useQueryFactoryTarget<TParams extends ManagedQueryFactoryParams>(
    targetId: string,
    factory: (params: TParams) => DataQuery,
    params: Omit<TParams, "interactionFilters">,
    highlightAlignment?: HighlightAlignment,
): QueryFactoryTargetState<InteractionTargetData> {
    // Keep track of the loader inputs and only update them when the JSON-serialized key changes.
    // This prevents unnecessary reloads when inline objects are used.
    const inputsKey: string = JSON.stringify([params, highlightAlignment ?? null]);
    const [loaderInputs, setLoaderInputs] = useState({ inputsKey, params, highlightAlignment });
    if (loaderInputs.inputsKey !== inputsKey) {
        setLoaderInputs({ inputsKey, params, highlightAlignment });
    }

    const loader: InteractionTargetLoader = useMemo(
        (): InteractionTargetLoader => createQueryFactoryLoader(factory, loaderInputs.params, loaderInputs.highlightAlignment),
        [factory, loaderInputs],
    );

    return useManagedInteractionTarget(targetId, loader);
}

function createQueryFactoryLoader<TParams extends ManagedQueryFactoryParams>(
    factory: (params: TParams) => DataQuery,
    params: Omit<TParams, "interactionFilters">,
    highlightAlignment: HighlightAlignment | undefined,
): InteractionTargetLoader {
    // `params` holds every factory input except `interactionFilters`, so adding the filters gives the
    // factory its complete input. TypeScript cannot prove that `Omit<TParams, "interactionFilters">`
    // plus `interactionFilters` equals a generic `TParams`, so the cast states it.
    const loadTable = (interactionFilters: readonly string[]): Promise<DataTable> =>
        executeQueryFactory(factory({ ...params, interactionFilters } as TParams));

    return async ({ isCrossHighlightActive, compiledFilters }: InteractionTargetLoadContext): Promise<InteractionTargetData> => {
        if (highlightAlignment) {
            if (isCrossHighlightActive) {
                // Both queries come from the same factory, so they share grouping keys, measures,
                // aliases, and app filters; only the interaction filter scope differs.
                const [all, highlightedSubset]: [DataTable, DataTable] = await Promise.all([
                    loadTable(compiledFilters.getFilters("baseline")),
                    loadTable(compiledFilters.getFilters("highlight")),
                ]);

                return createHighlightData(
                    all,
                    highlightedSubset,
                    highlightAlignment.groupingFields,
                    highlightAlignment.missingMeasureReplacementValues,
                    highlightAlignment.plottedMeasureFields,
                );
            }

            // If cross-highlight is not active, just load the baseline table and use it for both all and highlighted.
            const all: DataTable = await loadTable(compiledFilters.getFilters("baseline"));
            return { all, highlighted: all };
        }

        // Cross-highlight is not enabled, so just load the baseline table (which includes cross filters if any)
        return loadTable(compiledFilters.getFilters("baseline"));
    };
}
