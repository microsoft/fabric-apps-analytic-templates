//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
    buildEmbedUrl,
    launchPlaywright,
} from './open-fabric-portal.mjs';

const temporaryDirectories = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

function spawnRecorder() {
    const calls = [];
    return {
        calls,
        spawnProcess(command, args, options) {
            calls.push({ command, args, options });
            return { on() {} };
        },
    };
}

describe('open-fabric-portal', () => {
    it('builds the same encoded Fabric embed URL', () => {
        const url = buildEmbedUrl(
            {
                VITE_FABRIC_PORTAL_URL: 'https://example.fabric.microsoft.com/',
                VITE_FABRIC_WORKSPACE_ID: 'workspace',
                VITE_FABRIC_ITEM_ID: 'item',
            },
            { DEV_URL: 'http://localhost:4173/path?a=1&b=2' },
        );
        expect(url).toBe(
            'https://example.fabric.microsoft.com/groups/workspace/appbackends/item' +
            '?experience=power-bi&devUri=http%3A%2F%2Flocalhost%3A4173%2Fpath%3Fa%3D1%26b%3D2',
        );
    });

    it('launches the executable directly without a shell on non-Windows platforms', () => {
        const recorder = spawnRecorder();
        launchPlaywright('https://example.test/?a=1&b=2', {
            profileDirectory: '/home/test user/.rayfin/browser-profiles/fabric',
            platform: 'linux',
            processEnv: {},
            spawnProcess: recorder.spawnProcess,
        });

        expect(recorder.calls).toEqual([{
            command: 'playwright-cli',
            args: [
                '-s=fabric',
                'open',
                '--profile=/home/test user/.rayfin/browser-profiles/fabric',
                '--config=.playwright-config.json',
                'https://example.test/?a=1&b=2',
            ],
            options: {
                stdio: 'inherit',
                shell: false,
            },
        }]);
    });

    it.each([
        [{ ComSpec: 'C:\\Windows\\System32\\cmd.exe' }, 'C:\\Windows\\System32\\cmd.exe'],
        [{ COMSPEC: 'C:\\Windows\\System32\\cmd.exe' }, 'C:\\Windows\\System32\\cmd.exe'],
        [{}, 'cmd.exe'],
    ])('uses %s on Windows without passing arguments to shell:true', (shellEnvironment, expectedCommand) => {
        const recorder = spawnRecorder();
        const url = 'https://example.test/?a=1&b=2';
        const profileDirectory = 'C:\\Users\\Test User\\.rayfin\\browser-profiles\\fabric';
        launchPlaywright(url, {
            profileDirectory,
            platform: 'win32',
            processEnv: {
                PATH: 'C:\\tools',
                ...shellEnvironment,
            },
            spawnProcess: recorder.spawnProcess,
        });

        expect(recorder.calls).toHaveLength(1);
        const call = recorder.calls[0];
        expect(call.command).toBe(expectedCommand);
        expect(call.args).toEqual([
            '/d',
            '/s',
            '/c',
            'playwright-cli.cmd -s=fabric open --profile="%LYRA_FABRIC_BROWSER_PROFILE%" ' +
            '--config=.playwright-config.json "%LYRA_FABRIC_EMBED_URL%"',
        ]);
        expect(call.options.shell).toBe(false);
        expect(call.options.windowsVerbatimArguments).toBe(true);
        expect(call.options.env.LYRA_FABRIC_EMBED_URL).toBe(url);
        expect(call.options.env.LYRA_FABRIC_BROWSER_PROFILE).toBe(profileDirectory);
    });

    it('runs main when invoked through a symlink', () => {
        const temporaryDirectory = mkdtempSync(join(tmpdir(), 'open-fabric-portal-'));
        temporaryDirectories.push(temporaryDirectory);
        const scriptDirectory = dirname(fileURLToPath(import.meta.url));
        const linkedDirectory = join(temporaryDirectory, 'scripts');
        symlinkSync(scriptDirectory, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');

        const result = spawnSync(
            process.execPath,
            [join(linkedDirectory, 'open-fabric-portal.mjs')],
            {
                cwd: temporaryDirectory,
                encoding: 'utf8',
            },
        );

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(
            'Missing .env.local and .env.fabric — run `npx rayfin up` first.',
        );
    });
});
