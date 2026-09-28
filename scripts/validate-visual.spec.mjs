//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

// @vitest-environment node

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import * as headless from '@microsoft/fabric-visuals/headless';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createVisualInputLoader } from './visual-input.mjs';
import { main, renderVisual, runValidationBatch } from './validate-visual.mjs';

vi.mock('./visual-input.mjs', async (importOriginal) => ({
    ...await importOriginal(),
    createVisualInputLoader: vi.fn(),
}));

const execFileAsync = promisify(execFile);
const initialExitCode = process.exitCode;
const spec = {
    width: 320,
    height: 180,
    mark: 'bar',
    encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
    },
};
const data = {
    columns: [{ name: 'category' }, { name: 'value' }],
    rows: [['A', 10], ['B', 20]],
};
const loadedVisual = {
    factoryName: 'makeVisual',
    definition: { vegaLiteSpec: spec },
    queryTable: { rows: data.rows },
    dataTable: data,
};

afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(createVisualInputLoader).mockReset();
    process.exitCode = initialExitCode;
});

describe('visual validation', () => {
    it('validates sequentially and reports later factories after a failure', async () => {
        const requests = [
            { factoryPath: 'revenue.ts' },
            { factoryPath: 'broken.ts', params: { period: 'monthly' } },
            { factoryPath: 'trend.ts' },
        ];
        const visited = [];
        const report = await runValidationBatch(requests, async (request) => {
            visited.push(`start:${request.factoryPath}`);
            await Promise.resolve();
            visited.push(`end:${request.factoryPath}`);
            if (request.factoryPath === 'broken.ts') {
                throw new Error('Bad visual');
            }
            return { status: 'success', factoryPath: request.factoryPath };
        });

        expect(visited).toEqual(requests.flatMap(({ factoryPath }) => [
            `start:${factoryPath}`, `end:${factoryPath}`,
        ]));
        expect(report).toEqual({
            status: 'error',
            total: 3,
            passed: 2,
            failed: 1,
            results: [
                { status: 'success', factoryPath: 'revenue.ts' },
                { status: 'error', factoryPath: 'broken.ts', params: { period: 'monthly' }, error: 'Bad visual' },
                { status: 'success', factoryPath: 'trend.ts' },
            ],
        });
    });

    it('reports visible mark counts and in-memory SVG from the real headless API', async () => {
        const result = await renderVisual(spec, data);
        expect(result).toEqual({
            dataMarkCount: 2,
            diagnostics: expect.any(Array),
            markTypes: { rect: 2 },
            svg: expect.stringContaining('<svg'),
        });
    });

    it('rejects invisible geometry and empty renders with the query row count', async () => {
        const missingField = {
            mark: 'line',
            encoding: { ...spec.encoding, y: { field: 'missingValue', type: 'quantitative' } },
        };
        for (const [visualSpec, visualData] of [
            [missingField, data],
            [{ ...spec, mark: { type: 'bar', opacity: 0 } }, data],
            [spec, { ...data, rows: [] }],
        ]) {
            await expect(renderVisual(visualSpec, visualData)).rejects.toThrow(
                `Rendered ${visualData.rows.length} query rows without generating any visible data marks.`,
            );
        }
    });

    it('surfaces real Fabric compilation failures', async () => {
        await expect(renderVisual({
            ...spec,
            encoding: { ...spec.encoding, x: { field: 'category', type: 'not-a-type' } },
        }, data)).rejects.toThrow('Invalid field type');
    });

    it('formats error diagnostics before applying the zero-mark rule', async () => {
        vi.spyOn(headless, 'renderVisualToSvg').mockResolvedValueOnce({
            diagnostics: [
                { severity: 'warning', source: 'vega-lite', message: 'Warning only' },
                { severity: 'error', source: 'vega-lite', message: 'Invalid encoding' },
                { severity: 'error', source: 'fabric', message: 'Invalid transform' },
            ],
            renderedDataMarkCount: 0,
        });
        await expect(renderVisual(spec, data)).rejects.toThrow(
            '[vega-lite] Invalid encoding\n[fabric] Invalid transform',
        );
    });

    it('renders without browser globals and preserves top-level CLI failure output in plain Node', async () => {
        const validatorUrl = new URL('./validate-visual.mjs', import.meta.url);
        const { stdout, stderr } = await execFileAsync(process.execPath, [
            '--input-type=module', '--eval', `
                import { renderVisual } from ${JSON.stringify(validatorUrl.href)};
                const result = await renderVisual(${JSON.stringify(spec)}, ${JSON.stringify(data)});
                console.log(JSON.stringify({
                    dataMarkCount: result.dataMarkCount,
                    markTypes: result.markTypes,
                    hasSvg: result.svg.includes('<svg'),
                    hasDocument: typeof document !== 'undefined',
                }));
            `,
        ]);
        expect(JSON.parse(stdout)).toEqual({
            dataMarkCount: 2, markTypes: { rect: 2 }, hasSvg: true, hasDocument: false,
        });
        expect(stderr).toBe('');
        await expect(execFileAsync(process.execPath, [fileURLToPath(validatorUrl)]))
            .rejects.toMatchObject({
                code: 1,
                stdout: '',
                stderr: `${JSON.stringify({
                    status: 'error',
                    error: 'Usage: npm run validate:visual -- <query-factory.ts> [factory-params-json] '
                        + '[<query-factory.ts> [factory-params-json] ...]',
                }, null, 2)}\n`,
            });
    }, 30_000);
});

describe('validation command', () => {
    function mockLoader() {
        const loader = {
            load: vi.fn().mockResolvedValue(loadedVisual),
            close: vi.fn().mockResolvedValue(),
        };
        vi.mocked(createVisualInputLoader).mockResolvedValue(loader);
        return loader;
    }

    function successResult(params) {
        return {
            status: 'success', factoryPath: 'revenue.ts', factory: 'makeVisual', params,
            queryRows: 2, dataMarks: 2, markTypes: { rect: 2 },
            diagnostics: [{
                severity: 'warning', source: 'scrollTemplate', message: 'spec did not meet criteria for adding scroll',
            }],
        };
    }

    it('loads all parameter variants, closes once, and prints only the successful report', async () => {
        const loader = mockLoader();
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        process.exitCode = undefined;
        const report = await main(['revenue.ts', 'revenue.ts', '{"period":"monthly"}']);

        expect(report).toEqual({
            status: 'success', total: 2, passed: 2, failed: 0,
            results: [successResult(undefined), successResult({ period: 'monthly' })],
        });
        expect(createVisualInputLoader).toHaveBeenCalledExactlyOnceWith();
        expect(loader.load.mock.calls).toEqual([
            [{ factoryPath: 'revenue.ts', params: undefined }],
            [{ factoryPath: 'revenue.ts', params: { period: 'monthly' } }],
        ]);
        expect(loader.close).toHaveBeenCalledOnce();
        expect(loader.close.mock.invocationCallOrder[0]).toBeLessThan(log.mock.invocationCallOrder[0]);
        expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify(report, null, 2));
        expect(error).not.toHaveBeenCalled();
        expect(process.exitCode).toBeUndefined();
    });

    it('closes after load and render failures, reports later successes, and sets a failing exit status', async () => {
        const loader = mockLoader();
        loader.load.mockRejectedValueOnce('Query unavailable').mockResolvedValueOnce({
            ...loadedVisual,
            definition: { vegaLiteSpec: { ...spec, mark: { type: 'bar', opacity: 0 } } },
        });
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        process.exitCode = undefined;
        const report = await main(['broken.ts', '{"period":"yearly"}', 'invisible.ts', 'revenue.ts']);

        expect(report).toEqual({
            status: 'error', total: 3, passed: 1, failed: 2,
            results: [
                { status: 'error', factoryPath: 'broken.ts', params: { period: 'yearly' }, error: 'Query unavailable' },
                {
                    status: 'error', factoryPath: 'invisible.ts', params: undefined,
                    error: 'Rendered 2 query rows without generating any visible data marks.',
                },
                successResult(undefined),
            ],
        });
        expect(loader.load).toHaveBeenCalledTimes(3);
        expect(loader.close).toHaveBeenCalledOnce();
        expect(loader.close.mock.invocationCallOrder[0]).toBeLessThan(error.mock.invocationCallOrder[0]);
        expect(log).not.toHaveBeenCalled();
        expect(error).toHaveBeenCalledExactlyOnceWith(JSON.stringify(report, null, 2));
        expect(process.exitCode).toBe(1);
    });

    it('propagates cleanup failures instead of printing a successful report', async () => {
        const loader = mockLoader();
        loader.close.mockRejectedValueOnce(new Error('Close failed'));
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        await expect(main(['revenue.ts'])).rejects.toThrow('Close failed');
        expect(loader.close).toHaveBeenCalledOnce();
        expect(log).not.toHaveBeenCalled();
    });
});
