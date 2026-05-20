import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { bundleWebViewEditor } from './build'

describe('bundleWebViewEditor', () => {
    let workDir: string

    beforeEach(async () => {
        workDir = await mkdtemp(join(tmpdir(), 'webview-bundler-test-'))
    })

    it('inlines a TS entry into the HTML and emits a .ts module', async () => {
        const entryHtml = join(workDir, 'index.html')
        const entryScript = join(workDir, 'entry.ts')
        const outFile = join(workDir, 'out.ts')

        await writeFile(
            entryHtml,
            '<!DOCTYPE html><html><body><div id="root"></div><script src="entry.ts"></script></body></html>'
        )
        await writeFile(
            entryScript,
            'const MARKER = "TEST-MARKER-1234"; (globalThis as any).marker = MARKER;'
        )

        const result = await bundleWebViewEditor({ entryHtml, entryScript, outFile })

        expect(result.htmlSize).toBeGreaterThan(0)
        const out = await readFile(outFile, 'utf-8')
        expect(out).toMatch(/export const editorHtml/)
        // The marker text from the entry must end up inlined in the
        // emitted HTML (post-bundle, post-minify it survives as a
        // string literal even when minified).
        expect(out).toContain('TEST-MARKER-1234')
        // The original <script src=...> tag must be gone; the bundled
        // contents are inline.
        expect(out).not.toContain('src="entry.ts"')
    })

    it('throws when the entry HTML lacks a <script src> tag', async () => {
        const entryHtml = join(workDir, 'noscript.html')
        const entryScript = join(workDir, 'entry.ts')
        const outFile = join(workDir, 'out.ts')

        await writeFile(entryHtml, '<!DOCTYPE html><html><body></body></html>')
        await writeFile(entryScript, 'const x = 1')

        await expect(bundleWebViewEditor({ entryHtml, entryScript, outFile })).rejects.toThrow(
            /script src/i
        )
    })

    // The inlining step uses String.prototype.replace. If the
    // replacement is a string, `$&` / `$$` / `$1`... are interpreted as
    // backreferences and silently rewrite parts of the bundle to the
    // matched HTML tag. The real-world trigger was React's
    // `s.replace(rx, "$&/")` in the bundled output, but any source-text
    // sequence starting with `$` is a candidate. These tests pin the
    // function-replacement contract by exercising each pathological
    // sigil independently.
    //
    // Each test reads back the emitted .ts file and reconstructs the
    // inlined HTML by stripping the wrapping export and parsing the
    // JSON-stringified payload — that way assertions can be written
    // against the bundle-as-the-WebView-sees-it instead of the
    // double-escaped on-disk representation.
    async function readInlinedHtml(outFile: string): Promise<string> {
        const out = await readFile(outFile, 'utf-8')
        const match = out.match(/export const editorHtml = (.*)\n*$/s)
        if (!match) throw new Error('emitted file missing editorHtml export')
        return JSON.parse(match[1].trim())
    }

    it('preserves $& sequences in the bundled JS', async () => {
        const entryHtml = join(workDir, 'index.html')
        const entryScript = join(workDir, 'entry.ts')
        const outFile = join(workDir, 'out.ts')

        await writeFile(
            entryHtml,
            '<!DOCTYPE html><html><body><div id="root"></div><script src="entry.ts"></script></body></html>'
        )
        // The literal "$&/" string is the exact form that triggered the
        // bundle leak in production. minify: false keeps the marker
        // intact end-to-end so we can grep for it.
        await writeFile(entryScript, 'const MARKER = "x$&/y"; (globalThis as any).marker = MARKER;')

        await bundleWebViewEditor({ entryHtml, entryScript, outFile, minify: false })

        const html = await readInlinedHtml(outFile)
        expect(html).toContain('"x$&/y"')
        // And specifically must NOT contain the script-tag substitution
        // a string-replacement bug would inject.
        expect(html).not.toMatch(/x<script\s+[^>]*src=/)
    })

    it('preserves $$ sequences in the bundled JS', async () => {
        const entryHtml = join(workDir, 'index.html')
        const entryScript = join(workDir, 'entry.ts')
        const outFile = join(workDir, 'out.ts')

        await writeFile(
            entryHtml,
            '<!DOCTYPE html><html><body><div id="root"></div><script src="entry.ts"></script></body></html>'
        )
        // `$$typeof` is a real symbol from React. String-replace would
        // collapse `$$` to `$` and break the bundle.
        await writeFile(
            entryScript,
            'const M = "$$typeof:react.element"; (globalThis as any).m = M;'
        )

        await bundleWebViewEditor({ entryHtml, entryScript, outFile, minify: false })

        const html = await readInlinedHtml(outFile)
        expect(html).toContain('"$$typeof:react.element"')
    })

    it('escapes literal </script> in the bundled JS', async () => {
        const entryHtml = join(workDir, 'index.html')
        const entryScript = join(workDir, 'entry.ts')
        const outFile = join(workDir, 'out.ts')

        await writeFile(
            entryHtml,
            '<!DOCTYPE html><html><body><div id="root"></div><script src="entry.ts"></script></body></html>'
        )
        await writeFile(entryScript, 'const M = "<\\/script>"; (globalThis as any).m = M;')

        await bundleWebViewEditor({ entryHtml, entryScript, outFile, minify: false })

        const html = await readInlinedHtml(outFile)
        // The bundle's literal "</script>" must be escaped so the HTML
        // parser can't close the outer <script> tag prematurely. After
        // the escape pass it appears as <\/script> inside the inlined
        // JS source. Exactly one unescaped </script> should remain —
        // the one that closes the outer inlined script tag itself.
        expect(html).toContain('<\\/script>')
        const unescapedCloses = html.match(/<\/script>/g) ?? []
        expect(unescapedCloses.length).toBe(1)
    })
})
