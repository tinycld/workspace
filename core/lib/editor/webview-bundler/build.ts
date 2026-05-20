import { existsSync, statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import * as esbuild from 'esbuild'

// esbuild resolves scoped-package subpaths through the package's `exports`
// map. Sibling packages (and core) map subpaths with extensionless wildcard
// targets — e.g. core's `"./lib/*": "./lib/*"`, so `@tinycld/core/lib/store`
// resolves to the literal target `lib/store`. esbuild does NOT append a
// source extension to an `exports` target (per the Node spec, exports targets
// must be exact files), so `lib/store` only resolves when the package on disk
// is a symlink esbuild dereferences — which is the local dev layout. In the
// Docker build packages are real directories resolved purely via `nodePaths`,
// where that dereferencing never happens and the bundle fails with
// "Could not resolve @tinycld/core/lib/store".
//
// This plugin closes that gap: for any extensionless scoped-package subpath
// import, probe the package directory for `<sub>.{ts,tsx,...}` or
// `<sub>/index.{ts,tsx,...}` and resolve to the concrete file. Imports that
// already carry an extension, and bare package names (no subpath), fall
// through to esbuild's normal resolution untouched.
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json']

function probeSourceFile(base: string): string | null {
    if (existsSync(base) && statSync(base).isFile()) return base
    for (const ext of SOURCE_EXTENSIONS) {
        const withExt = base + ext
        if (existsSync(withExt)) return withExt
    }
    for (const ext of SOURCE_EXTENSIONS) {
        const index = join(base, `index${ext}`)
        if (existsSync(index)) return index
    }
    return null
}

function scopedSubpathResolver(roots: string[]): esbuild.Plugin {
    return {
        name: 'tinycld-scoped-subpath-resolver',
        setup(build) {
            build.onResolve({ filter: /^@[^/]+\/[^/]+\// }, args => {
                const match = args.path.match(/^(@[^/]+\/[^/]+)\/(.+)$/)
                if (match == null) return null
                const [, pkg, sub] = match
                if (/\.[a-z]+$/i.test(sub)) return null
                for (const root of roots) {
                    const pkgDir = join(root, pkg)
                    if (!existsSync(join(pkgDir, 'package.json'))) continue
                    const resolved = probeSourceFile(join(pkgDir, sub))
                    if (resolved != null) return { path: resolved }
                }
                return null
            })
        },
    }
}

export interface BundleWebViewEditorOptions {
    // Absolute or cwd-relative path to the entry HTML file. The HTML
    // should contain <div id="root"></div> and a <script src="..."/>
    // tag pointing to a sibling .tsx/.ts entry point. The bundler
    // inlines the script contents into the HTML.
    entryHtml: string

    // Absolute or cwd-relative path to the TS/TSX entry the HTML
    // <script> references. esbuild bundles this into a single string
    // that gets inlined.
    entryScript: string

    // Where to write the resulting TypeScript file. The file contains:
    //     export const editorHtml = `<!DOCTYPE html>...`
    outFile: string

    // Optional: additional define values passed to esbuild (process.env
    // shims, feature flags, etc.).
    define?: Record<string, string>

    // Optional: production minification. Default true.
    minify?: boolean

    // Optional: extra node_modules roots for module resolution. Useful
    // when the entry script lives outside the app shell's directory
    // tree (e.g. a sibling package's webview-editor/source/ folder)
    // and needs to resolve imports like '@tinycld/core/...', 'yjs',
    // '@tiptap/...' that are only installed in the app shell's
    // node_modules. Forwarded to esbuild's nodePaths option.
    nodePaths?: string[]
}

// bundleWebViewEditor packages a self-contained HTML page for use as
// TenTap's customSource. It runs esbuild against entryScript, inlines
// the resulting JS into entryHtml's <script> tag (replacing the src
// attribute), and emits a .ts file exporting the HTML as a string.
//
// This is a build-time helper, not runtime. Called from a package's
// build script (e.g. tinycld/text/webview-editor/build.ts) at dev
// startup and CI build time.
export async function bundleWebViewEditor(
    options: BundleWebViewEditorOptions
): Promise<{ outFile: string; htmlSize: number }> {
    const entryHtml = isAbsolute(options.entryHtml)
        ? options.entryHtml
        : resolve(process.cwd(), options.entryHtml)
    const entryScript = isAbsolute(options.entryScript)
        ? options.entryScript
        : resolve(process.cwd(), options.entryScript)
    const outFile = isAbsolute(options.outFile)
        ? options.outFile
        : resolve(process.cwd(), options.outFile)
    const minify = options.minify ?? true

    const nodePaths = options.nodePaths ?? []
    const result = await esbuild.build({
        entryPoints: [entryScript],
        bundle: true,
        format: 'iife',
        platform: 'browser',
        target: 'es2020',
        minify,
        write: false,
        nodePaths,
        plugins: nodePaths.length > 0 ? [scopedSubpathResolver(nodePaths)] : [],
        // outdir is required for esbuild to name outputs with proper
        // file extensions (entry.js, entry.css, ...). Without it esbuild
        // labels the sole output `<stdout>`, defeating the .js lookup
        // below the moment a non-JS asset enters the bundle. Nothing is
        // actually written to disk because write: false.
        outdir: 'out',
        define: {
            'process.env.NODE_ENV': '"production"',
            ...(options.define ?? {}),
        },
        loader: {
            '.tsx': 'tsx',
            '.ts': 'ts',
            '.jsx': 'jsx',
            '.js': 'js',
        },
        jsx: 'automatic',
    })

    if (result.warnings.length > 0) {
        for (const warning of result.warnings) {
            // biome-ignore lint/suspicious/noConsole: build-time helper; surfacing warnings is intentional
            console.warn(`bundleWebViewEditor: ${warning.text}`)
        }
    }

    const jsBundle = result.outputFiles.find(f => f.path.endsWith('.js'))?.text
    if (jsBundle == null) {
        throw new Error('bundleWebViewEditor: esbuild produced no .js output')
    }

    const rawHtml = await readFile(entryHtml, 'utf-8')

    // Replace <script src="..."></script> with <script>...inlined...</script>.
    // Substring approach keeps the build deterministic and avoids
    // pulling in a DOM parser. The HTML must contain exactly one
    // <script src=...> tag for this to work; entry HTML is small
    // enough that this constraint is reasonable.
    //
    // The replacement uses a *function* second argument rather than a
    // string. String.prototype.replace interprets `$&`, `$$`, `$1`, …
    // inside a string replacement as backreferences — and a minified
    // React/TipTap bundle absolutely contains those character sequences
    // (e.g. React's `s.replace(rx, "$&/")` from traverseAllChildrenImpl).
    // With a string replacement, every `$&` in the bundle gets
    // substituted with the matched HTML <script src="..."></script> tag,
    // injecting literal `</script>` sequences into the JS source. The
    // browser's HTML parser then closes the outer <script> tag at the
    // first such injection and the rest of the bundle leaks out as
    // plain body text. Function replacements skip $-pattern parsing.
    const scriptTagPattern = /<script\s+[^>]*src=["'][^"']+["'][^>]*>\s*<\/script>/i
    if (!scriptTagPattern.test(rawHtml)) {
        throw new Error(
            'bundleWebViewEditor: entry HTML must contain a <script src="..."></script> tag for inlining'
        )
    }
    const escapedBundle = jsBundle.replace(/<\/script>/g, '<\\/script>')
    const inlinedHtml = rawHtml.replace(scriptTagPattern, () => `<script>${escapedBundle}</script>`)

    const tsSource = [
        '// AUTO-GENERATED by @tinycld/core/lib/editor/webview-bundler.',
        '// Do not edit by hand. Regenerated on every dev start and CI build.',
        '/* eslint-disable */',
        '// biome-ignore lint: generated file',
        '',
        `export const editorHtml = ${JSON.stringify(inlinedHtml)}`,
        '',
    ].join('\n')

    await mkdir(dirname(outFile), { recursive: true })
    await writeFile(outFile, tsSource, 'utf-8')

    return { outFile, htmlSize: inlinedHtml.length }
}
