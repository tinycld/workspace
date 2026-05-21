import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discover } from '../src/discovery'

// Build a fake workspace: <ws>/{app,contacts,core} with app named "app".
function makeWs(): string {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'tcld-disc-'))
    fs.writeFileSync(
        path.join(ws, 'package.json'),
        JSON.stringify({ workspaces: ['app', 'contacts', 'core'] })
    )
    for (const [dir, name, manifest] of [
        ['app', 'app', false],
        ['contacts', '@tinycld/contacts', true],
        ['core', '@tinycld/core', false],
    ] as const) {
        fs.mkdirSync(path.join(ws, dir), { recursive: true })
        fs.writeFileSync(path.join(ws, dir, 'package.json'), JSON.stringify({ name }))
        if (manifest) fs.writeFileSync(path.join(ws, dir, 'manifest.ts'), 'export default {}')
    }
    return ws
}

describe('discover', () => {
    let ws: string
    beforeEach(() => {
        ws = makeWs()
    })
    afterEach(() => fs.rmSync(ws, { recursive: true, force: true }))

    it('finds the workspace root from a nested cwd', () => {
        const sub = path.join(ws, 'contacts', 'tinycld', 'contacts')
        fs.mkdirSync(sub, { recursive: true })
        const d = discover(sub)
        expect(d.workspaceRoot).toBe(fs.realpathSync(ws))
    })

    it('identifies the app shell member (name "app")', () => {
        const d = discover(path.join(ws, 'contacts'))
        expect(path.basename(d.appDir)).toBe('app')
    })

    it('infers the current package from cwd (feature with manifest.ts)', () => {
        const d = discover(path.join(ws, 'contacts', 'tinycld'))
        expect(d.currentPackage?.name).toBe('@tinycld/contacts')
        expect(d.currentPackage?.kind).toBe('feature')
    })

    it('treats the app shell as a valid scope target (no manifest.ts)', () => {
        const d = discover(path.join(ws, 'app'))
        expect(d.currentPackage?.kind).toBe('app')
    })
})
