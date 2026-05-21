import * as fs from 'node:fs'
import * as path from 'node:path'
import { getPackages } from '../../tinycld.packages'
import { manifestToConfigPkg } from './describe-packages'
import { type BuildPkg, runPackageBuilds } from './gen-build'
import { buildConfigSource, buildSeedsSource, type ConfigPkg } from './gen-config'
import { buildHelpSource, type HelpGroupInput, parseFrontmatter } from './gen-help'
import { emitPublicRoutes, emitRoutes } from './gen-routes'
import { buildGoWork, buildPackageExtensionsGo, replaceSymlink, type ServerPkg } from './gen-server'
import { buildUniwindSources, type UniwindSource } from './gen-uniwind'
import { loadManifest, type PackageManifest } from './load-manifest'
import {
    APP_DIR,
    GENERATED_DIR,
    HOOKS_DIR,
    MIGRATIONS_DIR,
    memberDir,
    ROUTES_BASE,
    SERVER_DIR,
    WS_ROOT,
} from './paths'

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

type Feature = { name: string; dir: string; manifest: PackageManifest }

// --- 3. routes: re-export each package's screens into app/a/[orgSlug]/<slug> -
// Do NOT cleanDir(ROUTES_BASE) — app-owned files live here (_layout.tsx,
// index.tsx, settings/**). Clean only each linked package's own slug dir.
// KNOWN TRADEOFF: a package unlinked since the last run leaves an orphan
// ROUTES_BASE/<old-slug>/ dir behind (the old full-wipe removed those). Fine
// while the linked set is stable; revisit (e.g. a generated-slugs manifest)
// if packages get unlinked frequently.
function emitFeatureRoutes(features: Feature[]) {
    fs.mkdirSync(ROUTES_BASE, { recursive: true })
    const appAppDir = path.join(APP_DIR, 'app')
    for (const f of features) {
        if (f.manifest.routes?.directory) emitOrgRoutes(f)
        if (f.manifest.publicRoutes?.directory) emitFeaturePublicRoutes(f, appAppDir)
    }
}

function emitOrgRoutes(f: Feature) {
    const slug = f.manifest.slug
    // Guard: slug must be a plain segment (no traversal) so the rmSync below
    // can't escape ROUTES_BASE. Slugs come from trusted manifests, but this
    // matches cleanDir's defensive posture for a destructive op.
    if (slug.includes('/') || slug.includes('..') || path.isAbsolute(slug)) {
        throw new Error(`[generate] invalid package slug '${slug}' — refusing to clean`)
    }
    const slugDir = path.join(ROUTES_BASE, slug)
    if (fs.existsSync(slugDir)) fs.rmSync(slugDir, { recursive: true, force: true })
    const routesDir = resolveExportDir(f.dir, f.manifest.routes!.directory)
    if (!routesDir) {
        console.warn(
            `[generate] ${f.name}: no exports entry for './${f.manifest.routes!.directory}/*' — routes skipped`
        )
        return
    }
    emitRoutes({
        packageName: f.name,
        slug,
        packageDir: f.dir,
        routesDir,
        importSubpath: f.manifest.routes!.directory,
        routesBase: ROUTES_BASE,
    })
}

function emitFeaturePublicRoutes(f: Feature, appAppDir: string) {
    const pubDir = resolveExportDir(f.dir, f.manifest.publicRoutes!.directory)
    if (!pubDir) {
        console.warn(
            `[generate] ${f.name}: no exports entry for './${f.manifest.publicRoutes!.directory}/*' — public routes skipped`
        )
        return
    }
    emitPublicRoutes({
        packageName: f.name,
        packageDir: f.dir,
        routesDir: pubDir,
        importSubpath: f.manifest.publicRoutes!.directory,
        appDir: appAppDir,
    })
}

// --- 4. package-help.ts (core + features) ------------------------------
function emitHelp(features: Feature[]) {
    const coreHelpDir = path.join(memberDir('@tinycld/core'), 'help')
    const helpSources: Feature[] = [
        // core help (core has a help/ dir but no manifest; include explicitly)
        ...(fs.existsSync(coreHelpDir)
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
    const helpGroups: HelpGroupInput[] = []
    for (const src of helpSources) {
        const group = readHelpGroup(src)
        if (group) helpGroups.push(group)
    }
    fs.writeFileSync(path.join(GENERATED_DIR, 'package-help.ts'), buildHelpSource(helpGroups))
}

function readHelpGroup(src: Feature): HelpGroupInput | null {
    if (!src.manifest.help?.directory) return null
    const helpDir = path.join(src.dir, src.manifest.help.directory)
    if (!fs.existsSync(helpDir)) return null
    const topics = fs
        .readdirSync(helpDir)
        .filter(f => f.endsWith('.md'))
        .map(file => ({
            topicId: file.replace(/\.md$/, ''),
            frontmatter: parseFrontmatter(fs.readFileSync(path.join(helpDir, file), 'utf8')),
        }))
    if (topics.length === 0) return null
    return { packageName: src.name, pkgSlug: src.manifest.slug, topics }
}

// --- 6. server: migration + hook symlinks ------------------------------
function symlinkServerArtifacts(features: Feature[]) {
    fs.mkdirSync(SERVER_DIR, { recursive: true })
    cleanDir(MIGRATIONS_DIR)
    cleanDir(HOOKS_DIR)
    // core migrations first (core has no manifest; include explicitly)
    linkDirContents(
        path.join(memberDir('@tinycld/core'), 'server', 'pb_migrations'),
        MIGRATIONS_DIR
    )
    for (const f of features) {
        if (f.manifest.migrations?.directory) {
            linkDirContents(path.join(f.dir, f.manifest.migrations.directory), MIGRATIONS_DIR)
        }
        if (f.manifest.hooks?.directory) {
            linkDirContents(path.join(f.dir, f.manifest.hooks.directory), HOOKS_DIR)
        }
    }
}

// Symlink every regular file in `srcDir` into `destDir` (no-op if srcDir absent).
function linkDirContents(srcDir: string, destDir: string) {
    if (!fs.existsSync(srcDir)) return
    for (const file of fs.readdirSync(srcDir)) {
        const srcPath = path.join(srcDir, file)
        if (!fs.statSync(srcPath).isFile()) continue
        replaceSymlink(srcPath, path.join(destDir, file))
    }
}

// --- 7. server: Go wiring (package_extensions.go + go.work) ------------
function emitGoWiring(features: Feature[]) {
    const serverPkgs: ServerPkg[] = features.filter(hasServerPackage).map(f => ({
        slug: f.manifest.slug,
        module: f.manifest.server!.module!,
        serverRelPath: path.relative(SERVER_DIR, path.join(f.dir, f.manifest.server!.package!)),
    }))
    fs.writeFileSync(
        path.join(SERVER_DIR, 'package_extensions.go'),
        buildPackageExtensionsGo(serverPkgs)
    )
    const coreServerRel = path.relative(SERVER_DIR, path.join(memberDir('@tinycld/core'), 'server'))
    const goWork = path.join(SERVER_DIR, 'go.work')
    if (serverPkgs.length > 0) {
        fs.writeFileSync(goWork, buildGoWork(coreServerRel, serverPkgs))
    } else if (fs.existsSync(goWork)) {
        fs.unlinkSync(goWork)
    }
}

function hasServerPackage(f: Feature): boolean {
    if (!f.manifest.server?.package) return false
    if (!fs.existsSync(path.join(f.dir, f.manifest.server.package))) return false
    if (!f.manifest.server.module) {
        console.warn(
            `[generate] ${f.manifest.slug}: server.package declared but server.module is missing — Go wiring skipped`
        )
        return false
    }
    return true
}

async function main() {
    const featureNames = getPackages().filter(n => n !== '@tinycld/core')

    // Load each FEATURE manifest (core has none).
    const features: Feature[] = await Promise.all(
        featureNames.map(async name => {
            const dir = memberDir(name)
            const manifest = await loadManifest(dir)
            return { name, dir, manifest }
        })
    )

    // --- 0. package builds (e.g. text's webview-editor → editorHtml.ts) ----
    // Run any manifest.build scripts first so their outputs exist for the
    // config emit + the subsequent typecheck/bundle.
    const builds: BuildPkg[] = features
        .filter(f => f.manifest.build?.script)
        .map(f => ({ packageName: f.name, packageDir: f.dir, script: f.manifest.build!.script }))
    runPackageBuilds(WS_ROOT, builds)

    fs.mkdirSync(GENERATED_DIR, { recursive: true })

    // --- 1. tinycld.config.ts + tinycld.seeds.ts (at app root) -------------
    const configPkgs: ConfigPkg[] = features.map(f => manifestToConfigPkg(f.name, f.manifest))
    fs.writeFileSync(path.join(APP_DIR, 'tinycld.config.ts'), buildConfigSource(configPkgs))
    fs.writeFileSync(path.join(APP_DIR, 'tinycld.seeds.ts'), buildSeedsSource(configPkgs))

    // --- 2. @tinycld/app-generated/tinycld-config re-export shim ------------
    // core imports `@tinycld/app-generated/tinycld-config`; the app supplies it.
    // Use NAMED re-exports, not `export *`: tinycld.config.ts transitively
    // imports each package's collections/provider, which import
    // @tinycld/core/lib/pocketbase, which eagerly calls
    // buildPackageStores(tinycldConfig) at module-eval — a cycle. Under vitest's
    // ESM transform a wildcard re-export leaves `tinycldConfig` undefined while
    // the cycle resolves ("entries is not iterable"); a named re-export creates
    // a proper live binding that settles once the source finishes. (Metro
    // tolerates either, but the test loader does not.)
    fs.writeFileSync(
        path.join(GENERATED_DIR, 'tinycld-config.ts'),
        "// Auto-generated — re-export of app's tinycld.config.ts\nexport { tinycldConfig } from '../../tinycld.config'\nexport type { MergedPackageSchema } from '../../tinycld.config'\n"
    )

    emitFeatureRoutes(features)
    emitHelp(features)

    // --- 5. uniwind-sources.css (core + features, real paths) --------------
    const uniwindSources: UniwindSource[] = [
        { packageName: '@tinycld/core', packageDir: fs.realpathSync(memberDir('@tinycld/core')) },
        ...features.map(f => ({ packageName: f.name, packageDir: fs.realpathSync(f.dir) })),
    ]
    fs.writeFileSync(
        path.join(GENERATED_DIR, 'uniwind-sources.css'),
        buildUniwindSources(uniwindSources)
    )

    symlinkServerArtifacts(features)
    emitGoWiring(features)

    console.log(`Generated config for ${features.length} feature package(s).`)
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
