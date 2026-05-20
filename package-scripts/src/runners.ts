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

export function buildTypecheckCommand(pkg: CurrentPackage, _appDir: string): Command {
    return { bin: 'tsc', args: ['--noEmit', '-p', tsconfigFor(pkg)], cwd: pkg.dir }
}

export function buildTestCommand(pkg: CurrentPackage, _appDir: string): Command {
    return { bin: 'vitest', args: ['run', '--config', vitestConfigFor(pkg)], cwd: pkg.dir }
}

export function buildE2eCommand(pkg: CurrentPackage, _appDir: string): Command {
    return { bin: 'playwright', args: ['test', '--config', playwrightConfigFor(pkg)], cwd: pkg.dir }
}

export function buildCheckCommands(pkg: CurrentPackage, appDir: string): Command[] {
    return [buildTypecheckCommand(pkg, appDir), buildTestCommand(pkg, appDir)]
}
