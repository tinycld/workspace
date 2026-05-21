import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

export interface PackageManifest {
    name: string
    slug: string
    version: string
    description: string
    routes?: { directory: string }
    publicRoutes?: { directory: string }
    nav?: { label: string; icon: string; order?: number; shortcut?: string }
    migrations?: { directory: string }
    hooks?: { directory: string }
    collections?: { register: string; types: string }
    sidebar?: { component: string }
    provider?: { component: string }
    settings?: { slug: string; component: string; label: string }[]
    seed?: { script: string }
    tests?: { directory: string }
    build?: { script: string }
    server?: { package: string; module: string }
    help?: { directory: string }
    dependencies?: string[]
}

// Import a member's manifest.ts (ESM default export). This file is run via tsx,
// so a dynamic import of a .ts file works.
export async function loadManifest(packageDir: string): Promise<PackageManifest> {
    const candidate = ['manifest.ts', 'manifest.js']
        .map(f => path.join(packageDir, f))
        .find(p => fs.existsSync(p))
    if (!candidate) throw new Error(`No manifest found in ${packageDir}`)
    const mod = await import(pathToFileURL(candidate).href)
    return mod.default as PackageManifest
}
