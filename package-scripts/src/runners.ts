import * as path from 'node:path'
import type { CurrentPackage } from './discovery'

export interface Command {
    bin: string
    args: string[]
    cwd: string
}

// A package's own tsconfig (feature) or the app's tsconfig (app shell).
function tsconfigFor(pkg: CurrentPackage): string {
    return path.join(pkg.dir, 'tsconfig.json')
}
function vitestConfigFor(pkg: CurrentPackage): string {
    return path.join(pkg.dir, 'vitest.config.ts')
}
function playwrightConfigFor(pkg: CurrentPackage): string {
    return path.join(pkg.dir, 'playwright.config.ts')
}

// `passthrough` are extra args forwarded verbatim to the underlying runner
// (e.g. `tinycld-pkg test:e2e -- -g "name" --workers=1`). They append after the
// fixed args so callers can filter to a single test, cap workers, etc.
export function buildTypecheckCommand(
    pkg: CurrentPackage,
    _appDir: string,
    passthrough: string[] = []
): Command {
    return { bin: 'tsc', args: ['--noEmit', '-p', tsconfigFor(pkg), ...passthrough], cwd: pkg.dir }
}

export function buildTestCommand(
    pkg: CurrentPackage,
    _appDir: string,
    passthrough: string[] = []
): Command {
    return {
        bin: 'vitest',
        args: ['run', '--config', vitestConfigFor(pkg), ...passthrough],
        cwd: pkg.dir,
    }
}

export function buildE2eCommand(
    pkg: CurrentPackage,
    _appDir: string,
    passthrough: string[] = []
): Command {
    return {
        bin: 'playwright',
        args: ['test', '--config', playwrightConfigFor(pkg), ...passthrough],
        cwd: pkg.dir,
    }
}

// check runs typecheck + unit; passthrough only makes sense for one runner at a
// time, so it is intentionally NOT forwarded here (a combined run has no single
// target for a filter). Use `test` or `typecheck` directly to pass args.
export function buildCheckCommands(pkg: CurrentPackage, appDir: string): Command[] {
    return [buildTypecheckCommand(pkg, appDir), buildTestCommand(pkg, appDir)]
}
