import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const WS = path.resolve(import.meta.dirname, '..', '..', '..')
const ORG_DIR = path.join(WS, 'app', 'app', 'a', '[orgSlug]')

describe('generator preserves app-owned [orgSlug] files', () => {
    const sentinel = path.join(ORG_DIR, '_sentinel_layout.tsx')
    const subSentinel = path.join(ORG_DIR, 'settings', '_sentinel_settings.tsx')
    beforeEach(() => {
        fs.mkdirSync(path.join(ORG_DIR, 'settings'), { recursive: true })
        fs.writeFileSync(sentinel, '// app-owned, must survive generation\n')
        fs.writeFileSync(subSentinel, '// app-owned subdir file, must survive\n')
    })
    afterEach(() => {
        if (fs.existsSync(sentinel)) fs.rmSync(sentinel)
        if (fs.existsSync(subSentinel)) fs.rmSync(subSentinel)
        // remove the settings dir if now empty
        try {
            fs.rmdirSync(path.join(ORG_DIR, 'settings'))
        } catch {
            // not empty or already gone — leave it
        }
    })

    it('does not delete a hand-written file under [orgSlug] when regenerating', () => {
        execFileSync('node_modules/.bin/tsx', ['app/scripts/generate.ts'], { cwd: WS, stdio: 'pipe' })
        expect(fs.existsSync(sentinel)).toBe(true)
        expect(fs.existsSync(subSentinel)).toBe(true)
        // and it still generates the contacts package routes
        expect(fs.existsSync(path.join(ORG_DIR, 'contacts', 'index.tsx'))).toBe(true)
    })
})
