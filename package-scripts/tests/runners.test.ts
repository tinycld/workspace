import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCheckCommands, buildTestCommand, buildTypecheckCommand } from '../src/runners'

const appDir = '/ws/app'
const featurePkg = { dir: '/ws/contacts', name: '@tinycld/contacts', kind: 'feature' as const }
const appPkg = { dir: '/ws/app', name: 'app', kind: 'app' as const }

describe('buildTypecheckCommand', () => {
    it('runs tsc against the package tsconfig', () => {
        const cmd = buildTypecheckCommand(featurePkg, appDir)
        expect(cmd.bin).toBe('tsc')
        expect(cmd.args).toEqual(['--noEmit', '-p', path.join('/ws/contacts', 'tsconfig.json')])
        expect(cmd.cwd).toBe('/ws/contacts')
    })
})

describe('buildTestCommand', () => {
    it('runs vitest with the package vitest.config', () => {
        const cmd = buildTestCommand(featurePkg, appDir)
        expect(cmd.bin).toBe('vitest')
        expect(cmd.args).toEqual(['run', '--config', path.join('/ws/contacts', 'vitest.config.ts')])
    })
    it('for the app shell, uses the app vitest.config', () => {
        const cmd = buildTestCommand(appPkg, appDir)
        expect(cmd.args).toContain(path.join('/ws/app', 'vitest.config.ts'))
    })
})

describe('buildCheckCommands', () => {
    it('is typecheck then test (NOT e2e)', () => {
        const cmds = buildCheckCommands(featurePkg, appDir)
        expect(cmds.map(c => c.bin)).toEqual(['tsc', 'vitest'])
    })
})
