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

export async function renderVisual(spec, data) {
    const result = await renderVisualToSvg(spec, { data });
    const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
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
        diagnostics: result.diagnostics,
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
