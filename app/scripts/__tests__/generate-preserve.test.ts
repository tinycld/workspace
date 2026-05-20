import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const WS = path.resolve(import.meta.dirname, '..', '..', '..')
const ORG_DIR = path.join(WS, 'app', 'app', 'a', '[orgSlug]')

describe('generator preserves app-owned [orgSlug] files', () => {
    const sentinel = path.join(ORG_DIR, '_sentinel_layout.tsx')
    beforeEach(() => {
        fs.mkdirSync(ORG_DIR, { recursive: true })
        fs.writeFileSync(sentinel, '// app-owned, must survive generation\n')
    })
    afterEach(() => {
        if (fs.existsSync(sentinel)) fs.rmSync(sentinel)
    })

    it('does not delete a hand-written file under [orgSlug] when regenerating', () => {
        execFileSync('node_modules/.bin/tsx', ['app/scripts/generate.ts'], { cwd: WS, stdio: 'pipe' })
        expect(fs.existsSync(sentinel)).toBe(true)
        // and it still generates the contacts package routes
        expect(fs.existsSync(path.join(ORG_DIR, 'contacts', 'index.tsx'))).toBe(true)
    })
})
