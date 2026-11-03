//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { renderVisualToSvg } from '@microsoft/fabric-visuals/headless';

import { createVisualInputLoader, parseValidationRequests } from './visual-input.mjs';

const CUSTOM_ARC_LABELS_DIAGNOSTIC = {
    severity: 'warning',
    source: 'visualAuthoring',
    message: 'This pie/donut uses an authored text layer, so Fabric managed labels are disabled. '
        + 'Use a unit arc spec unless custom labels are intentional.',
};

function markType(spec) {
    return typeof spec?.mark === 'string' ? spec.mark : spec?.mark?.type;
}

function fieldName(channel) {
    return typeof channel?.field === 'string' ? channel.field : undefined;
}

function hasAuthoredArcLabels(spec) {
    if (!spec || typeof spec !== 'object') return false;

    if (Array.isArray(spec.layer)) {
        const sharedThetaField = fieldName(spec.encoding?.theta);
        const arcThetaFields = new Set(spec.layer
            .filter((layer) => markType(layer) === 'arc')
            .map((layer) => fieldName(layer.encoding?.theta) ?? sharedThetaField)
            .filter(Boolean));
        const hasMatchingTextLayer = spec.layer.some((layer) =>
            markType(layer) === 'text'
            && layer.encoding?.text !== undefined
            && arcThetaFields.has(fieldName(layer.encoding?.theta) ?? sharedThetaField));

        if (hasMatchingTextLayer) return true;
        if (spec.layer.some(hasAuthoredArcLabels)) return true;
    }

    for (const key of ['concat', 'hconcat', 'vconcat']) {
        if (Array.isArray(spec[key]) && spec[key].some(hasAuthoredArcLabels)) return true;
    }
    return hasAuthoredArcLabels(spec.spec);
}

export function getVisualAuthoringDiagnostics(spec) {
    return hasAuthoredArcLabels(spec) ? [{ ...CUSTOM_ARC_LABELS_DIAGNOSTIC }] : [];
}

export async function renderVisual(spec, data) {
    const result = await renderVisualToSvg(spec, { data });
    const diagnostics = [...result.diagnostics, ...getVisualAuthoringDiagnostics(spec)];
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    if (errors.length > 0) {
        throw new Error(errors
            .map((diagnostic) => `[${diagnostic.source}] ${diagnostic.message}`)
            .join('\n'));
    }
    if (result.renderedDataMarkCount === 0) {
        throw new Error(
            `Rendered ${data.rows.length} query rows without generating any visible data marks.`,
        );
    }

    return {
        dataMarkCount: result.renderedDataMarkCount,
        diagnostics,
        markTypes: result.renderedMarkCountsByType,
        svg: result.svg,
    };
}

export async function runValidationBatch(requests, validateRequest) {
    const results = [];
    for (const request of requests) {
        try {
            results.push(await validateRequest(request));
        } catch (error) {
            results.push({
                status: 'error',
                factoryPath: request.factoryPath,
                params: request.params,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    const failed = results.filter((result) => result.status === 'error').length;
    return {
        status: failed > 0 ? 'error' : 'success',
        total: results.length,
        passed: results.length - failed,
        failed,
        results,
    };
}

export async function main(args = process.argv.slice(2)) {
    const requests = parseValidationRequests(args);
    const loader = await createVisualInputLoader();

    let report;
    try {
        report = await runValidationBatch(requests, async ({ factoryPath, params }) => {
            const { definition, factoryName, queryTable, dataTable } = await loader.load({
                factoryPath,
                params,
            });
            const summary = await renderVisual(definition.vegaLiteSpec, dataTable);

            return {
                status: 'success',
                factoryPath,
                factory: factoryName,
                params,
                queryRows: queryTable.rows.length,
                dataMarks: summary.dataMarkCount,
                markTypes: summary.markTypes,
                diagnostics: summary.diagnostics,
            };
        });
    } finally {
        await loader.close();
    }

    const output = JSON.stringify(report, null, 2);
    if (report.failed > 0) {
        console.error(output);
        process.exitCode = 1;
    } else {
        console.log(output);
    }
    return report;
}

const isMainModule = process.argv[1]
    && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMainModule) {
    main().catch((error) => {
        console.error(JSON.stringify({
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
        }, null, 2));
        process.exitCode = 1;
    });
}
