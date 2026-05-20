import * as fs from 'node:fs'
import * as path from 'node:path'

// Recursively list files (relative paths) under dir.
function walkFiles(dir: string, prefix = ''): string[] {
    if (!fs.existsSync(dir)) return []
    const out: string[] = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? path.join(prefix, entry.name) : entry.name
        if (entry.isDirectory()) out.push(...walkFiles(path.join(dir, entry.name), rel))
        else out.push(rel)
    }
    return out
}

const ROUTE_EXTS = new Set(['.tsx', '.ts', '.jsx', '.js'])

export interface EmitRoutesOpts {
    packageName: string
    slug: string
    packageDir: string
    routesDir: string // path RELATIVE to packageDir where screen files live
    importSubpath: string // the package.json exports subpath, e.g. 'screens'
    routesBase: string // app/app/a/[orgSlug]
}

// Emit one `export { default } from '<pkg>/<subpath>/<file>'` per screen file,
// preserving directory structure, under routesBase/<slug>/.
export function emitRoutes(opts: EmitRoutesOpts): string[] {
    const screensDir = path.join(opts.packageDir, opts.routesDir)
    const files = walkFiles(screensDir).filter(f => ROUTE_EXTS.has(path.extname(f)))
    const pkgRouteDir = path.join(opts.routesBase, opts.slug)
    fs.mkdirSync(pkgRouteDir, { recursive: true })

    const written: string[] = []
    for (const file of files) {
        const withoutExt = file.replace(/\.[^.]+$/, '')
        const importPath = `${opts.packageName}/${opts.importSubpath}/${withoutExt}`
        const outFile = path.join(pkgRouteDir, file)
        fs.mkdirSync(path.dirname(outFile), { recursive: true })
        fs.writeFileSync(outFile, `export { default } from '${importPath}'\n`)
        written.push(outFile)
    }
    return written
}

export interface EmitPublicRoutesOpts {
    packageName: string
    packageDir: string
    routesDir: string // relative to packageDir
    importSubpath: string // e.g. 'public-screens'
    appDir: string // app/app
}

export function emitPublicRoutes(opts: EmitPublicRoutesOpts): string[] {
    const sourceDir = path.join(opts.packageDir, opts.routesDir)
    const files = walkFiles(sourceDir).filter(f => ROUTE_EXTS.has(path.extname(f)))
    const written: string[] = []
    for (const file of files) {
        const withoutExt = file.replace(/\.[^.]+$/, '')
        const importPath = `${opts.packageName}/${opts.importSubpath}/${withoutExt}`
        const outFile = path.join(opts.appDir, file)
        fs.mkdirSync(path.dirname(outFile), { recursive: true })
        fs.writeFileSync(outFile, `export { default } from '${importPath}'\n`)
        written.push(outFile)
    }
    return written
}
