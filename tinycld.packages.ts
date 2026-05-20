import * as fs from 'node:fs'
import * as path from 'node:path'

// New flat layout: every package (core, app, features) is a direct member dir
// under the workspace root. core is the member whose package.json name is
// "@tinycld/core" (it has no manifest.ts). Feature members are dirs with a
// manifest.ts. Members without a manifest.ts are excluded (this includes the app shell).
//
// TINYCLD_WS_ROOT overrides the workspace root for tests that scan a fake tree.
// It is resolved at call time (not module load) so that tests can set it in
// beforeEach after the module is already imported.
const CORE_NAME = '@tinycld/core'

let cached: string[] | null = null

/**
 * Returns the package names linked into the app, core first then features
 * sorted by name. Core is the member named "@tinycld/core" (no manifest.ts);
 * feature members are dirs containing a manifest.ts with a named package.json.
 * The app shell is excluded. Cached per process; reset with resetPackagesCache().
 */
export function getPackages(): string[] {
    if (cached) return cached

    const wsRoot = process.env.TINYCLD_WS_ROOT
        ? path.resolve(process.env.TINYCLD_WS_ROOT)
        : path.resolve(import.meta.dirname)

    let core: string | null = null
    const features: string[] = []

    if (fs.existsSync(wsRoot)) {
        for (const entry of fs.readdirSync(wsRoot)) {
            const dir = path.join(wsRoot, entry)
            if (!isDir(dir)) continue
            const pkgJsonPath = path.join(dir, 'package.json')
            if (!fs.existsSync(pkgJsonPath)) continue
            let name: unknown
            try {
                name = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')).name
            } catch {
                continue // unreadable package.json
            }
            if (typeof name !== 'string' || name.length === 0) continue
            if (name === CORE_NAME) {
                core = name
                continue
            }
            if (hasManifest(dir)) features.push(name)
        }
    }

    features.sort()
    cached = core ? [core, ...features] : features
    return cached
}

// Test-only: clear the per-process cache so a fresh TINYCLD_WS_ROOT is read.
export function resetPackagesCache(): void {
    cached = null
}

function hasManifest(dir: string): boolean {
    return (
        fs.existsSync(path.join(dir, 'manifest.ts')) || fs.existsSync(path.join(dir, 'manifest.js'))
    )
}

function isDir(p: string): boolean {
    try {
        return fs.statSync(p).isDirectory()
    } catch {
        return false
    }
}
