#!/usr/bin/env tsx
import * as fs from 'node:fs'
import * as path from 'node:path'
import { type CurrentPackage, discover } from './discovery'
import { runAll } from './orchestrator'
import {
    buildCheckCommands,
    buildE2eCommand,
    buildTestCommand,
    buildTypecheckCommand,
    type Command,
} from './runners'
import { runCommand } from './spawn'

type Verb = 'typecheck' | 'test' | 'test:e2e' | 'check'

function commandsFor(
    verb: Verb,
    pkg: CurrentPackage,
    appDir: string,
    passthrough: string[]
): Command[] {
    switch (verb) {
        case 'typecheck':
            return [buildTypecheckCommand(pkg, appDir, passthrough)]
        case 'test':
            return [buildTestCommand(pkg, appDir, passthrough)]
        case 'test:e2e':
            return [buildE2eCommand(pkg, appDir, passthrough)]
        case 'check':
            return buildCheckCommands(pkg, appDir)
        default:
            throw new Error(
                `Unknown verb '${verb}'. Use one of: typecheck | test | test:e2e | check`
            )
    }
}

// Build the "all" target list for a verb: features (+ app shell and core for
// non-e2e). Read the workspace member dirs directly to avoid importing app code.
function allTargets(workspaceRoot: string, appDir: string, verb: Verb): CurrentPackage[] {
    const targets: CurrentPackage[] = []
    for (const entry of fs.readdirSync(workspaceRoot)) {
        const dir = path.join(workspaceRoot, entry)
        let pj: { name?: string }
        try {
            pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
        } catch {
            continue
        }
        const hasManifest =
            fs.existsSync(path.join(dir, 'manifest.ts')) ||
            fs.existsSync(path.join(dir, 'manifest.js'))
        if (hasManifest && pj.name) targets.push({ dir, name: pj.name, kind: 'feature' })
        else if (dir === appDir && pj.name === 'app' && verb !== 'test:e2e')
            targets.push({ dir, name: 'app', kind: 'app' })
        // core: shared lib, no manifest, no e2e — but typecheck/test/check it.
        else if (pj.name === '@tinycld/core' && verb !== 'test:e2e')
            targets.push({ dir, name: '@tinycld/core', kind: 'core' })
    }
    // Skip targets that have nothing to run for the verb.
    return targets.filter(t => {
        if (verb === 'test:e2e') return fs.existsSync(path.join(t.dir, 'playwright.config.ts'))
        if (verb === 'test') return fs.existsSync(path.join(t.dir, 'vitest.config.ts'))
        return fs.existsSync(path.join(t.dir, 'tsconfig.json'))
    })
}

async function runForPackage(
    verb: Verb,
    pkg: CurrentPackage,
    appDir: string,
    passthrough: string[]
): Promise<number> {
    for (const cmd of commandsFor(verb, pkg, appDir, passthrough)) {
        const code = await runCommand(cmd)
        if (code !== 0) return code
    }
    return 0
}

async function main() {
    const argv = process.argv.slice(2)
    const [verb, ...rest] = argv as [Verb, ...string[]]
    if (!verb) {
        console.error(
            'usage: tinycld-pkg <typecheck|test|test:e2e|check> [--all] [--bail] [-- <runner args>]'
        )
        process.exit(2)
    }
    // Everything after a `--` separator is forwarded verbatim to the underlying
    // runner (vitest/playwright/tsc) — e.g. `test:e2e -- -g "name" --workers=1`
    // to filter to one test. Args before `--` are tinycld-pkg's own flags.
    const sepIndex = rest.indexOf('--')
    const ownArgs = sepIndex === -1 ? rest : rest.slice(0, sepIndex)
    const passthrough = sepIndex === -1 ? [] : rest.slice(sepIndex + 1)
    const all = ownArgs.includes('--all')
    const bail = ownArgs.includes('--bail')

    if (all && passthrough.length > 0) {
        console.error(
            'Cannot combine --all with `-- <runner args>`: passthrough targets a single package.'
        )
        process.exit(2)
    }
    const { workspaceRoot, appDir, currentPackage } = discover()

    if (all) {
        const targets = allTargets(workspaceRoot, appDir, verb)
        const result = await runAll(
            targets.map(t => t.name),
            async name => {
                const pkg = targets.find(t => t.name === name)!
                console.log(`\n=== ${verb} ${name} ===`)
                return runForPackage(verb, pkg, appDir, [])
            },
            { bail }
        )
        const summary = result.results
            .map(r => `${r.code === 0 ? '✓' : '✗'} ${r.target}`)
            .join('  ')
        console.log(`\n${summary}`)
        process.exit(result.exitCode)
    }

    if (!currentPackage) {
        console.error('Not inside a package or the app shell.')
        process.exit(2)
    }
    const code = await runForPackage(verb, currentPackage, appDir, passthrough)
    process.exit(code)
}

main()
