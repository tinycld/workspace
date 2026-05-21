import { renderPrintEnvelope } from '@tinycld/core/lib/print/render-print-envelope'
import { describe, expect, it } from 'vitest'
import { buildTextPrintCssWeb } from '../tinycld/text/lib/print/print-css-web'

// Snapshot the text-print pipeline: server-rendered fragment + text
// print CSS + core's envelope wrapper. The old `renderPrintHtml`
// shim (lib/print/render-print-html.ts) used to do all three steps
// in one call; with the server-side renderer, the fragment comes
// from the server (`fetchRenderedHtml`) and the envelope lives in
// core. These tests cover the parts text owns: the CSS string and
// the envelope's structural guarantees.

describe('text print envelope', () => {
    const sampleFragment =
        '<article class="tinycld-text"><p class="tinycld-text-p">hello</p></article>'

    it('produces a full HTML document with doctype', () => {
        const html = renderPrintEnvelope(sampleFragment, buildTextPrintCssWeb())
        expect(html.startsWith('<!doctype html>')).toBe(true)
        expect(html).toContain('<html')
        expect(html).toContain('<head>')
        expect(html).toContain('<body>')
        expect(html).toContain('</html>')
    })

    it('includes the print CSS inside a <style> block in <head>', () => {
        const html = renderPrintEnvelope(sampleFragment, buildTextPrintCssWeb())
        expect(html).toMatch(
            /<head>[\s\S]*<style>[\s\S]*@page[\s\S]*<\/style>[\s\S]*<\/head>/
        )
    })

    it('embeds the server fragment verbatim', () => {
        const html = renderPrintEnvelope(sampleFragment, buildTextPrintCssWeb())
        expect(html).toContain(sampleFragment)
    })

    it('emits CSS rules that target the tinycld-text class vocabulary', () => {
        const css = buildTextPrintCssWeb()
        expect(css).toContain('.tinycld-text-p')
        expect(css).toContain('.tinycld-text-h1')
        expect(css).toContain('.tinycld-text-table')
        expect(css).toContain('.tinycld-text-mark--bold')
        // Class vocabulary moved away from .ProseMirror / .print-document.
        expect(css).not.toMatch(/\.ProseMirror\b/)
        expect(css).not.toMatch(/\.print-document\b/)
    })

    it('does not reference external assets that expo-print cannot bundle', () => {
        const css = buildTextPrintCssWeb()
        expect(css).not.toMatch(/<link\b/i)
        expect(css).not.toMatch(/@import\b/i)
        expect(css).not.toMatch(/@font-face\b/i)
    })

    it('sets portrait orientation and a sensible margin', () => {
        const css = buildTextPrintCssWeb()
        expect(css).toMatch(/@page\s*\{[^}]*size:\s*portrait/)
        expect(css).toMatch(/margin:\s*0\.75in/)
    })

    it('forwards heading + paragraph fragments verbatim', () => {
        const fragment =
            '<article class="tinycld-text">' +
            '<h1 class="tinycld-text-h1">Title</h1>' +
            '<h2 class="tinycld-text-h2">Sub</h2>' +
            '<p class="tinycld-text-p">Body text.</p>' +
            '</article>'
        const html = renderPrintEnvelope(fragment, buildTextPrintCssWeb())
        expect(html).toContain('<h1 class="tinycld-text-h1">Title</h1>')
        expect(html).toContain('<h2 class="tinycld-text-h2">Sub</h2>')
        expect(html).toContain('<p class="tinycld-text-p">Body text.</p>')
    })

    it('forwards table + image content carried by the server fragment', () => {
        const fragment =
            '<article class="tinycld-text">' +
            '<table class="tinycld-text-table"><tbody><tr>' +
            '<td class="tinycld-text-td">cell</td>' +
            '</tr></tbody></table>' +
            '<p class="tinycld-text-p"><img class="tinycld-text-img" src="data:image/png;base64,iVBORw0KGgo=" alt="pic"></p>' +
            '</article>'
        const html = renderPrintEnvelope(fragment, buildTextPrintCssWeb())
        expect(html).toContain('cell')
        expect(html).toContain('data:image/png;base64,iVBORw0KGgo=')
        expect(html).toContain('alt="pic"')
    })

    it('forwards inline mark spans', () => {
        const fragment =
            '<article class="tinycld-text"><p class="tinycld-text-p">' +
            '<span class="tinycld-text-mark--bold">b</span>' +
            '<span class="tinycld-text-mark--italic">i</span>' +
            '<a class="tinycld-text-mark--link" href="https://example.com">link</a>' +
            '</p></article>'
        const html = renderPrintEnvelope(fragment, buildTextPrintCssWeb())
        expect(html).toContain('tinycld-text-mark--bold')
        expect(html).toContain('tinycld-text-mark--italic')
        expect(html).toContain('href="https://example.com"')
    })

    it('handles empty fragment', () => {
        const html = renderPrintEnvelope('', buildTextPrintCssWeb())
        expect(html).toContain('<body>')
        expect(html).toContain('</body>')
    })
})
