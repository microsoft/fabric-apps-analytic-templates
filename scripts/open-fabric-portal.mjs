//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

// Composes the Fabric portal embed URL from .env.local (or .env.fabric*) and
// launches `playwright-cli -s=fabric open --profile=<dir>` with the LNA-disable
// Chromium flags. See .agents/skills/app-validation/references/fabric-embed.md
// for the full background.
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';

export function parseEnvFile(file) {
    return Object.fromEntries(
        readFileSync(file, 'utf8')
            .split('\n')
            .filter((line) => line && !line.startsWith('#') && line.includes('='))
            .map((line) => {
                const index = line.indexOf('=');
                return [
                    line.slice(0, index).trim(),
                    line.slice(index + 1).trim().replace(/^["']|["']$/g, ''),
                ];
            }),
    );
}

export function readFabricEnvironment(cwd) {
    const candidates = ['.env.local', '.env.fabric'].map((file) => resolve(cwd, file));
    const found = candidates.filter((file) => existsSync(file));
    if (found.length === 0) {
        throw new Error('Missing .env.local and .env.fabric — run `npx rayfin up` first.');
    }
    return found.reduce((acc, file) => ({ ...parseEnvFile(file), ...acc }), {});
}

export function buildEmbedUrl(env, processEnv = process.env) {
    const portal = (env.VITE_FABRIC_PORTAL_URL || '').replace(/\/$/, '');
    const workspace = env.VITE_FABRIC_WORKSPACE_ID;
    const item = env.VITE_FABRIC_ITEM_ID;
    const dev = processEnv.DEV_URL || 'http://localhost:5173';

    if (!portal || !workspace || !item) {
        throw new Error(
            'Need VITE_FABRIC_PORTAL_URL, VITE_FABRIC_WORKSPACE_ID, ' +
            'VITE_FABRIC_ITEM_ID in .env.local or .env.fabric.',
        );
    }
    return `${portal}/groups/${workspace}/appbackends/${item}` +
        `?experience=power-bi&devUri=${encodeURIComponent(dev)}`;
}

export function launchPlaywright(url, {
    profileDirectory,
    platform = process.platform,
    processEnv = process.env,
    spawnProcess = spawn,
} = {}) {
    if (!profileDirectory) {
        throw new Error('Cannot launch playwright-cli without a browser profile directory.');
    }
    const playwrightArgs = [
        '-s=fabric',
        'open',
        `--profile=${profileDirectory}`,
        '--config=.playwright-config.json',
        url,
    ];
    if (platform !== 'win32') {
        return spawnProcess('playwright-cli', playwrightArgs, {
            stdio: 'inherit',
            shell: false,
        });
    }

    const commandShell = processEnv.ComSpec || processEnv.COMSPEC || 'cmd.exe';
    const urlVariable = 'LYRA_FABRIC_EMBED_URL';
    const profileVariable = 'LYRA_FABRIC_BROWSER_PROFILE';
    return spawnProcess(
        commandShell,
        [
            '/d',
            '/s',
            '/c',
            `playwright-cli.cmd -s=fabric open --profile="%${profileVariable}%" ` +
            `--config=.playwright-config.json "%${urlVariable}%"`,
        ],
        {
            stdio: 'inherit',
            shell: false,
            windowsVerbatimArguments: true,
            env: {
                ...processEnv,
                [urlVariable]: url,
                [profileVariable]: profileDirectory,
            },
        },
    );
}

export function main({
    cwd = process.cwd(),
    processEnv = process.env,
    platform = process.platform,
    spawnProcess = spawn,
} = {}) {
    let url;
    try {
        url = buildEmbedUrl(readFabricEnvironment(cwd), processEnv);
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        return 1;
    }

    const profileDirectory = processEnv.FABRIC_BROWSER_PROFILE ||
        join(homedir(), '.rayfin', 'browser-profiles', 'fabric');
    mkdirSync(profileDirectory, { recursive: true });

    console.log(`Opening Fabric portal embed → ${url}`);
    console.log(`Browser profile: ${profileDirectory}`);
    console.log(
        'First run only: the embed signs in across several Microsoft origins, so you may be prompted more than once.',
    );
    console.log('This profile is shared by every project, so later runs sign in silently.');

    const child = launchPlaywright(url, {
        profileDirectory,
        platform,
        processEnv,
        spawnProcess,
    });
    child.on('error', (error) => {
        console.error(`Could not launch playwright-cli: ${error.message}`);
        process.exitCode = 1;
    });
    child.on('exit', (code) => {
        process.exitCode = code ?? 0;
    });
    return 0;
}

if (import.meta.main) {
    process.exitCode = main();
}
