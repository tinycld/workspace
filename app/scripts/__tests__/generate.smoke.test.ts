import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

const APP_DIR = path.resolve(import.meta.dirname, '..', '..')
const ORG_DIR = path.join(APP_DIR, 'app', 'a', '[orgSlug]')

// Uniquely-named app-owned sentinels under [orgSlug] — must survive generation
// (the generator must clean only per-package slug dirs, not app-owned files).
// Kept in THIS file (the only one that invokes the real generator) so two test
// files never run the generator against the shared workspace concurrently.
const rootSentinel = path.join(ORG_DIR, '_preserve_test_root.tsx')
const subDir = path.join(ORG_DIR, '_preserve_test_dir')
const subSentinel = path.join(subDir, 'file.tsx')

describe('generate.ts (smoke, real workspace)', () => {
    it('produces config/routes/help/uniwind AND preserves app-owned [orgSlug] files', () => {
        // Seed app-owned sentinels before generating.
        fs.mkdirSync(subDir, { recursive: true })
        fs.writeFileSync(rootSentinel, '// app-owned root file, must survive generation\n')
        fs.writeFileSync(subSentinel, '// app-owned subdir file, must survive generation\n')
        try {
            execFileSync('node_modules/.bin/tsx', ['app/scripts/generate.ts'], {
                cwd: path.resolve(APP_DIR, '..'),
                stdio: 'pipe',
            })
            // App-owned files under [orgSlug] survive a generator run.
            expect(fs.existsSync(rootSentinel)).toBe(true)
            expect(fs.existsSync(subSentinel)).toBe(true)
        } finally {
            if (fs.existsSync(rootSentinel)) fs.rmSync(rootSentinel)
            if (fs.existsSync(subDir)) fs.rmSync(subDir, { recursive: true, force: true })
        }
        const config = fs.readFileSync(path.join(APP_DIR, 'tinycld.config.ts'), 'utf8')
        expect(config).toContain('export const tinycldConfig')
        expect(config).toContain('@tinycld/contacts')
        expect(config).toContain('export type MergedPackageSchema')

        const routeIndex = path.join(APP_DIR, 'app', 'a', '[orgSlug]', 'contacts', 'index.tsx')
        expect(fs.existsSync(routeIndex)).toBe(true)
        expect(fs.readFileSync(routeIndex, 'utf8')).toContain(
            "from '@tinycld/contacts/screens/index'"
        )

        expect(fs.existsSync(path.join(APP_DIR, 'lib', 'generated', 'package-help.ts'))).toBe(true)
        const css = fs.readFileSync(
            path.join(APP_DIR, 'lib', 'generated', 'uniwind-sources.css'),
            'utf8'
        )
        expect(css).toContain('@source')
        expect(css).toContain('contacts')

        // tinycld.seeds.ts
        expect(fs.existsSync(path.join(APP_DIR, 'tinycld.seeds.ts'))).toBe(true)
        expect(fs.readFileSync(path.join(APP_DIR, 'tinycld.seeds.ts'), 'utf8')).toContain(
            'tinycldSeeds'
        )

        // the @tinycld/app-generated/tinycld-config re-export shim (core imports through it)
        const shim = path.join(APP_DIR, 'lib', 'generated', 'tinycld-config.ts')
        expect(fs.existsSync(shim)).toBe(true)
        expect(fs.readFileSync(shim, 'utf8')).toContain("export * from '../../tinycld.config'")
    })
})
