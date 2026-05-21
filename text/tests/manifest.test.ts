// Real manifest validation. The manifest is the contract the package
// generator (tinycld/scripts/generate-packages.ts) reads to wire
// routes, providers, sidebars, migrations, and the Go server. A typo
// or stale directory reference here causes the generator to silently
// skip work or produce broken imports — failures the developer only
// notices when a feature mysteriously stops appearing in the app.
//
// What we verify:
//   - identity fields (name, slug, version, description)
//   - cross-package dependencies are present and well-formed
//   - server.module string matches the Go module declared in
//     server/go.mod (drift here breaks the Go-side wiring)
//   - every directory the manifest references actually exists on disk
//     (the generator walks these via fs.readdir; missing dirs are
//     silently empty)
//   - every component pointer the manifest references resolves through
//     the package.json `exports` map to a file that exists
//
// The package.json exports map is checked separately to ensure it
// covers every entry point declared by the manifest. Without this
// check, adding e.g. `manifest.sidebar.component = 'sidebar'` while
// forgetting to add `./sidebar` to the exports map produces a runtime
// import error inside the app shell — but `pnpm run test:unit` would
// pass because nothing exercises the import path.

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import manifest from '../manifest'

const PACKAGE_ROOT = resolve(__dirname, '..')

interface PackageJson {
    name: string
    exports: Record<string, string>
}

const pkg: PackageJson = JSON.parse(
    readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8')
)

/**
 * Resolve a manifest subpath (e.g. 'screens', 'sidebar') through the
 * package.json exports map to a filesystem path relative to the
 * package root. Mirrors what tinycld/scripts/generate-packages.ts's
 * resolveExportPath does in production.
 */
function resolveSubpath(subpath: string): string | null {
    const exports = pkg.exports ?? {}
    const exactKey = `./${subpath}`
    if (exactKey in exports) {
        return exports[exactKey].replace(/^\.\//, '')
    }
    for (const key of Object.keys(exports)) {
        if (!key.endsWith('/*')) continue
        const base = key.slice(2, -2)
        if (subpath === base) {
            const pattern = exports[key].replace(/^\.\//, '')
            return pattern.split('/*')[0]
        }
        if (subpath.startsWith(`${base}/`)) {
            const pattern = exports[key].replace(/^\.\//, '')
            const dir = pattern.split('/*')[0]
            const rest = subpath.slice(base.length + 1)
            return join(dir, rest)
        }
    }
    return null
}

describe('text manifest identity', () => {
    it('declares the canonical name, slug, and semver', () => {
        expect(manifest.name).toBe('Text')
        expect(manifest.slug).toBe('text')
        expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/)
    })

    it('matches its package.json name', () => {
        expect(pkg.name).toBe('@tinycld/text')
    })

    it('has a single-character nav shortcut', () => {
        expect(manifest.nav?.shortcut).toBeDefined()
        expect(manifest.nav?.shortcut?.length).toBe(1)
    })
})

describe('text manifest dependencies', () => {
    it('declares drive as a dependency (text reuses drive_items for storage)', () => {
        expect(manifest.dependencies).toContain('drive')
    })

    it('lists each dependency as a non-empty kebab/lower string', () => {
        const deps = manifest.dependencies ?? []
        for (const dep of deps) {
            expect(typeof dep).toBe('string')
            expect(dep).toMatch(/^[a-z][a-z0-9-]*$/)
        }
    })
})

describe('text manifest server module', () => {
    it('matches the module declared in server/go.mod', () => {
        const goModPath = join(PACKAGE_ROOT, 'server', 'go.mod')
        expect(existsSync(goModPath), 'server/go.mod must exist').toBe(true)
        const goMod = readFileSync(goModPath, 'utf-8')
        const moduleMatch = goMod.match(/^module\s+(\S+)/m)
        expect(moduleMatch).not.toBeNull()
        const goModuleName = moduleMatch?.[1]
        expect(manifest.server?.module).toBe(goModuleName)
    })

    it('points at a server/ subdirectory that exists', () => {
        expect(manifest.server?.package).toBe('server')
        expect(existsSync(join(PACKAGE_ROOT, 'server'))).toBe(true)
    })
})

describe('text manifest directories on disk', () => {
    it("resolves routes.directory through the exports map to a real directory", () => {
        const sub = manifest.routes?.directory
        expect(sub).toBeDefined()
        const fsPath = resolveSubpath(sub!)
        expect(fsPath, `exports map must cover ./${sub}`).not.toBeNull()
        expect(existsSync(join(PACKAGE_ROOT, fsPath!))).toBe(true)
    })

    it('resolves provider.component through the exports map to a real .tsx', () => {
        const sub = manifest.provider?.component
        expect(sub).toBeDefined()
        const fsPath = resolveSubpath(sub!)
        expect(fsPath, `exports map must cover ./${sub}`).not.toBeNull()
        expect(
            existsSync(join(PACKAGE_ROOT, `${fsPath!}.tsx`)) ||
                existsSync(join(PACKAGE_ROOT, fsPath!))
        ).toBe(true)
    })

    it('routes directory contains at least one screen .tsx', () => {
        const sub = manifest.routes?.directory
        const fsPath = resolveSubpath(sub!)!
        const dir = join(PACKAGE_ROOT, fsPath)
        const { readdirSync } = require('node:fs')
        const entries: string[] = readdirSync(dir)
        const screens = entries.filter(e => e.endsWith('.tsx'))
        expect(screens.length).toBeGreaterThan(0)
    })
})
