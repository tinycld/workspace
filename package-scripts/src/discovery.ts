import * as fs from 'node:fs'
import * as path from 'node:path'

export interface CurrentPackage {
    dir: string
    name: string
    kind: 'feature' | 'app' | 'core'
}
export interface Discovery {
    workspaceRoot: string
    appDir: string
    currentPackage: CurrentPackage | null
}

function readName(dir: string): string | null {
    try {
        return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name ?? null
    } catch {
        return null
    }
}

function hasManifest(dir: string): boolean {
    return (
        fs.existsSync(path.join(dir, 'manifest.ts')) || fs.existsSync(path.join(dir, 'manifest.js'))
    )
}

// Resolve the real path of the nearest existing ancestor.
function realpathExisting(p: string): string {
    let dir = path.resolve(p)
    while (!fs.existsSync(dir)) {
        const parent = path.dirname(dir)
        if (parent === dir) return dir
        dir = parent
    }
    return fs.realpathSync(dir)
}

// Walk up until a package.json with a `workspaces` field is found.
function findWorkspaceRoot(start: string): string {
    let dir = realpathExisting(start)
    while (true) {
        const pj = path.join(dir, 'package.json')
        if (fs.existsSync(pj)) {
            try {
                if (JSON.parse(fs.readFileSync(pj, 'utf8')).workspaces) return dir
            } catch {
                // keep walking
            }
        }
        const parent = path.dirname(dir)
        if (parent === dir) throw new Error(`No workspace root found above ${start}`)
        dir = parent
    }
}

// The app shell = the workspace member whose package.json name is "app".
function findAppDir(workspaceRoot: string): string {
    for (const entry of fs.readdirSync(workspaceRoot)) {
        const dir = path.join(workspaceRoot, entry)
        try {
            if (fs.statSync(dir).isDirectory() && readName(dir) === 'app') return dir
        } catch {
            // skip
        }
    }
    throw new Error(`No app shell (member named "app") under ${workspaceRoot}`)
}

// The current scope target = nearest ancestor of cwd that is a feature package
// (has manifest.ts), the app shell (name "app"), or core (name "@tinycld/core").
// core, like the app shell, has no manifest.ts — it's the shared lib, not a
// feature — so it's matched by name.
function findCurrentPackage(start: string, appDir: string): CurrentPackage | null {
    let dir = realpathExisting(start)
    const root = path.dirname(appDir) // workspace root
    while (true) {
        if (fs.existsSync(path.join(dir, 'package.json'))) {
            const name = readName(dir)
            if (dir === appDir && name === 'app') return { dir, name, kind: 'app' }
            if (name === '@tinycld/core') return { dir, name, kind: 'core' }
            if (hasManifest(dir) && name) return { dir, name, kind: 'feature' }
        }
        const parent = path.dirname(dir)
        if (parent === dir || dir === root) break
        dir = parent
    }
    return null
}

export function discover(cwd: string = process.cwd()): Discovery {
    const workspaceRoot = findWorkspaceRoot(cwd)
    const appDir = findAppDir(workspaceRoot)
    const currentPackage = findCurrentPackage(cwd, appDir)
    return { workspaceRoot, appDir: fs.realpathSync(appDir), currentPackage }
}
