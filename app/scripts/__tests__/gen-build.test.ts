import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveBuildScriptPath } from '../gen-build'

describe('resolveBuildScriptPath', () => {
    let dir: string
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcld-build-'))
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x' }))
    })
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

    it('resolves a bare script name to <script>.ts', () => {
        const sub = path.join(dir, 'webview-editor')
        fs.mkdirSync(sub, { recursive: true })
        fs.writeFileSync(path.join(sub, 'build.ts'), '// build')
        expect(resolveBuildScriptPath(dir, 'webview-editor/build')).toBe(path.join(sub, 'build.ts'))
    })

    it('prefers an exports-map entry when present', () => {
        fs.writeFileSync(
            path.join(dir, 'package.json'),
            JSON.stringify({ name: 'x', exports: { './build': './scripts/do-build.ts' } })
        )
        const sub = path.join(dir, 'scripts')
        fs.mkdirSync(sub, { recursive: true })
        fs.writeFileSync(path.join(sub, 'do-build.ts'), '// build')
        expect(resolveBuildScriptPath(dir, 'build')).toBe(path.join(sub, 'do-build.ts'))
    })

    it('throws a clear error when the script is missing', () => {
        expect(() => resolveBuildScriptPath(dir, 'nope/build')).toThrow(/build script not found/i)
    })
})
