import * as fs from 'node:fs'
import * as path from 'node:path'
import { getPackages } from '../../tinycld.packages'
import { manifestToConfigPkg } from './describe-packages'
import { buildConfigSource, buildSeedsSource, type ConfigPkg } from './gen-config'
import { buildHelpSource, type HelpGroupInput, parseFrontmatter } from './gen-help'
import { emitPublicRoutes, emitRoutes } from './gen-routes'
import { buildUniwindSources, type UniwindSource } from './gen-uniwind'
import { buildGoWork, buildPackageExtensionsGo, replaceSymlink, type ServerPkg } from './gen-server'
import { loadManifest, type PackageManifest } from './load-manifest'
import { APP_DIR, GENERATED_DIR, ROUTES_BASE, SERVER_DIR, MIGRATIONS_DIR, HOOKS_DIR, memberDir } from './paths'

// Resolve a package.json exports subpath to a directory relative to packageDir.
// e.g. exports['./screens/*'] === './tinycld/contacts/screens/*.tsx'
// → returns 'tinycld/contacts/screens' for subpath 'screens'.
function resolveExportDir(packageDir: string, subpath: string): string | null {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'))
    const exp = pkgJson.exports?.[`./${subpath}/*`]
    if (typeof exp !== 'string') return null
    // strip leading './' and trailing '/*.<ext>'
    return exp.replace(/^\.\//, '').replace(/\/\*\.[^.]+$/, '')
}

function cleanDir(dir: string) {
    // Safety: only ever rm -rf a routes dir under app/a/. Guards against a
    // misconfigured APP_DIR turning this into a destructive rm of the wrong tree.
    if (!dir.includes(path.join('app', 'a')) && !dir.includes(path.join('app', 'server'))) {
        throw new Error(`cleanDir refused: ${dir} is not under app/a/ or app/server/`)
    }
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
}

async function main() {
    const packageNames = getPackages() // ['@tinycld/core', '@tinycld/contacts', ...]
    const featureNames = packageNames.filter(n => n !== '@tinycld/core')

    // Load each FEATURE manifest (core has none).
    const features = await Promise.all(
        featureNames.map(async name => {
            const dir = memberDir(name)
            const manifest = await loadManifest(dir)
            return { name, dir, manifest }
        })
    )

    fs.mkdirSync(GENERATED_DIR, { recursive: true })

    // --- 1. tinycld.config.ts + tinycld.seeds.ts (at app root) -------------
    const configPkgs: ConfigPkg[] = features.map(f => manifestToConfigPkg(f.name, f.manifest))
    fs.writeFileSync(path.join(APP_DIR, 'tinycld.config.ts'), buildConfigSource(configPkgs))
    fs.writeFileSync(path.join(APP_DIR, 'tinycld.seeds.ts'), buildSeedsSource(configPkgs))

    // --- 2. @tinycld/app-generated/tinycld-config re-export shim ------------
    // core imports `@tinycld/app-generated/tinycld-config`; the app supplies it.
    fs.writeFileSync(
        path.join(GENERATED_DIR, 'tinycld-config.ts'),
        "// Auto-generated — re-export of app's tinycld.config.ts\nexport * from '../../tinycld.config'\n"
    )

    // --- 3. routes ----------------------------------------------------------
    // Do NOT cleanDir(ROUTES_BASE) — app-owned files live here (_layout.tsx,
    // index.tsx, settings/**). Clean only each linked package's own slug dir.
    fs.mkdirSync(ROUTES_BASE, { recursive: true })
    const appAppDir = path.join(APP_DIR, 'app')
    for (const f of features) {
        if (f.manifest.routes?.directory) {
            const slugDir = path.join(ROUTES_BASE, f.manifest.slug)
            if (fs.existsSync(slugDir)) fs.rmSync(slugDir, { recursive: true, force: true })
            const routesDir = resolveExportDir(f.dir, f.manifest.routes.directory)
            if (routesDir) {
                emitRoutes({
                    packageName: f.name,
                    slug: f.manifest.slug,
                    packageDir: f.dir,
                    routesDir,
                    importSubpath: f.manifest.routes.directory,
                    routesBase: ROUTES_BASE,
                })
            } else {
                console.warn(
                    `[generate] ${f.name}: no exports entry for './${f.manifest.routes.directory}/*' — routes skipped`
                )
            }
        }
        if (f.manifest.publicRoutes?.directory) {
            const pubDir = resolveExportDir(f.dir, f.manifest.publicRoutes.directory)
            if (pubDir) {
                emitPublicRoutes({
                    packageName: f.name,
                    packageDir: f.dir,
                    routesDir: pubDir,
                    importSubpath: f.manifest.publicRoutes.directory,
                    appDir: appAppDir,
                })
            } else {
                console.warn(
                    `[generate] ${f.name}: no exports entry for './${f.manifest.publicRoutes.directory}/*' — public routes skipped`
                )
            }
        }
    }

    // --- 4. package-help.ts (core + features) ------------------------------
    const helpGroups: HelpGroupInput[] = []
    const helpSources: { name: string; dir: string; manifest: PackageManifest }[] = [
        // core help (core has a help/ dir but no manifest; include explicitly)
        ...(fs.existsSync(path.join(memberDir('@tinycld/core'), 'help'))
            ? [
                  {
                      name: '@tinycld/core',
                      dir: memberDir('@tinycld/core'),
                      manifest: { help: { directory: 'help' }, slug: 'core' } as PackageManifest,
                  },
              ]
            : []),
        ...features,
    ]
    for (const src of helpSources) {
        if (!src.manifest.help?.directory) continue
        const helpDir = path.join(src.dir, src.manifest.help.directory)
        if (!fs.existsSync(helpDir)) continue
        const topics = fs
            .readdirSync(helpDir)
            .filter(f => f.endsWith('.md'))
            .map(file => ({
                topicId: file.replace(/\.md$/, ''),
                frontmatter: parseFrontmatter(fs.readFileSync(path.join(helpDir, file), 'utf8')),
            }))
        if (topics.length > 0) {
            helpGroups.push({ packageName: src.name, pkgSlug: src.manifest.slug, topics })
        }
    }
    fs.writeFileSync(path.join(GENERATED_DIR, 'package-help.ts'), buildHelpSource(helpGroups))

    // --- 5. uniwind-sources.css (core + features, real paths) --------------
    const uniwindSources: UniwindSource[] = [
        { packageName: '@tinycld/core', packageDir: fs.realpathSync(memberDir('@tinycld/core')) },
        ...features.map(f => ({ packageName: f.name, packageDir: fs.realpathSync(f.dir) })),
    ]
    fs.writeFileSync(
        path.join(GENERATED_DIR, 'uniwind-sources.css'),
        buildUniwindSources(uniwindSources)
    )

    // --- 6. server: migration + hook symlinks ------------------------------
    fs.mkdirSync(SERVER_DIR, { recursive: true })
    cleanDir(MIGRATIONS_DIR)
    cleanDir(HOOKS_DIR)
    // core migrations first (core has no manifest; include explicitly)
    const coreMig = path.join(memberDir('@tinycld/core'), 'server', 'pb_migrations')
    if (fs.existsSync(coreMig)) {
        for (const file of fs.readdirSync(coreMig)) {
            const srcPath = path.join(coreMig, file)
            if (!fs.statSync(srcPath).isFile()) continue
            replaceSymlink(srcPath, path.join(MIGRATIONS_DIR, file))
        }
    }
    for (const f of features) {
        if (f.manifest.migrations?.directory) {
            const dir = path.join(f.dir, f.manifest.migrations.directory)
            if (fs.existsSync(dir)) {
                for (const file of fs.readdirSync(dir)) {
                    const srcPath = path.join(dir, file)
                    if (!fs.statSync(srcPath).isFile()) continue
                    replaceSymlink(srcPath, path.join(MIGRATIONS_DIR, file))
                }
            }
        }
        if (f.manifest.hooks?.directory) {
            const dir = path.join(f.dir, f.manifest.hooks.directory)
            if (fs.existsSync(dir)) {
                for (const file of fs.readdirSync(dir)) {
                    const srcPath = path.join(dir, file)
                    if (!fs.statSync(srcPath).isFile()) continue
                    replaceSymlink(srcPath, path.join(HOOKS_DIR, file))
                }
            }
        }
    }

    // --- 7. server: Go wiring (package_extensions.go + go.work) ------------
    const serverPkgs: ServerPkg[] = features
        .filter(f => {
            if (!f.manifest.server?.package) return false
            if (!fs.existsSync(path.join(f.dir, f.manifest.server.package))) return false
            if (!f.manifest.server.module) {
                console.warn(
                    `[generate] ${f.manifest.slug}: server.package declared but server.module is missing — Go wiring skipped`
                )
                return false
            }
            return true
        })
        .map(f => ({
            slug: f.manifest.slug,
            module: f.manifest.server!.module,
            serverRelPath: path.relative(
                SERVER_DIR,
                path.join(f.dir, f.manifest.server!.package)
            ),
        }))
    fs.writeFileSync(
        path.join(SERVER_DIR, 'package_extensions.go'),
        buildPackageExtensionsGo(serverPkgs)
    )
    const coreServerRel = path.relative(SERVER_DIR, path.join(memberDir('@tinycld/core'), 'server'))
    if (serverPkgs.length > 0) {
        fs.writeFileSync(path.join(SERVER_DIR, 'go.work'), buildGoWork(coreServerRel, serverPkgs))
    } else {
        const gw = path.join(SERVER_DIR, 'go.work')
        if (fs.existsSync(gw)) fs.unlinkSync(gw)
    }

    console.log(`Generated config for ${features.length} feature package(s).`)
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
