import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleWebViewEditor } from '@tinycld/core/lib/editor/webview-bundler/build'

// Text's WebView-editor build entry. Called by:
//   npx tsx tinycld/text/webview-editor/build.ts
// from the @tinycld/text repo root. Produces a self-contained HTML
// string at tinycld/text/webview-editor/build/editorHtml.ts which
// the native useDocumentEditor imports and hands to TenTap's
// customSource option.

const here = dirname(fileURLToPath(import.meta.url))
const sourceDir = resolve(here, 'source')
const buildDir = resolve(here, 'build')

// The source/ folder lives in the @tinycld/text sibling repo, which has no
// node_modules of its own by design. The entry script imports from
// @tinycld/core/*, yjs, y-protocols, @tiptap/*, etc., all of which only
// exist in the app shell's node_modules. Pointing esbuild at that tree via
// nodePaths lets module resolution succeed.
//
// Prefer TINYCLD_APP_ROOT (set by generate-packages.ts) so this works in
// both the dev sibling layout (~/code/tinycld/{text,tinycld}/) and the
// docker build layout (/app/ is the app shell, packages are baked under
// /app/packages/<scope>/<pkg>/). Fall back to the legacy relative path for
// folks running this script standalone outside the generator.
const appShellRoot =
    process.env.TINYCLD_APP_ROOT ?? resolve(here, '../../../../tinycld')
const appShellNodeModules = resolve(appShellRoot, 'node_modules')

async function main() {
    const result = await bundleWebViewEditor({
        entryHtml: resolve(sourceDir, 'index.html'),
        entryScript: resolve(sourceDir, 'entry.tsx'),
        outFile: resolve(buildDir, 'editorHtml.ts'),
        nodePaths: [appShellNodeModules],
    })
    // biome-ignore lint/suspicious/noConsole: build-time helper; surfacing the bundle size is intentional
    console.log(`[text webview-editor] bundled ${result.htmlSize} bytes → ${result.outFile}`)
}

main().catch(err => {
    // biome-ignore lint/suspicious/noConsole: build-time helper; reporting the failure is intentional
    console.error('[text webview-editor] build failed:', err)
    process.exit(1)
})
