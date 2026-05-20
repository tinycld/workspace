// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'

// Tell React 19 we're in an act-friendly testing environment. Without
// this, createRoot().render() emits a console warning even when the
// call is already wrapped in act(). The warning is non-fatal but
// noisy.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// HtmlSurface imports `View` from react-native. The global unit-setup
// stubs react-native to a minimal surface (Platform/Dimensions);
// extend that here so View renders as a passthrough <div> wrapper
// instead of throwing "View is not a function".
vi.mock('react-native', () => ({
    Platform: { OS: 'web' },
    Dimensions: {
        get: () => ({ width: 1024, height: 768 }),
        addEventListener: () => ({ remove: () => {} }),
    },
    View: ({ children, ...rest }: React.PropsWithChildren<Record<string, unknown>>) => {
        const React = require('react')
        return React.createElement('div', rest, children)
    },
}))

import { buildHtmlSurfaceSrcDoc, HtmlSurface } from '@tinycld/core/file-viewer/HtmlSurface'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

describe('buildHtmlSurfaceSrcDoc', () => {
    it('returns a self-contained HTML document', () => {
        const out = buildHtmlSurfaceSrcDoc('<p>x</p>', 'body{margin:0}')
        expect(out.startsWith('<!doctype html>')).toBe(true)
        expect(out).toContain('<meta charset="utf-8">')
        expect(out).toContain('<style>body{margin:0}</style>')
        expect(out).toContain('<body><p>x</p>')
        expect(out.endsWith('</html>')).toBe(true)
    })

    it('embeds a resize-observer script that posts back to the parent', () => {
        const out = buildHtmlSurfaceSrcDoc('', '')
        expect(out).toContain('tinycld-html-surface-size')
        expect(out).toContain('parent.postMessage')
    })

    it('passes through the fragment and CSS without escaping', () => {
        // The envelope is the trust boundary: server-side sanitization
        // guarantees the fragment can be inlined safely. Don't add
        // re-escaping here or sanitized tags get mangled.
        const fragment = '<section class="tinycld-doc"><p>&amp;</p></section>'
        const css = '.tinycld-doc { color: red; }'
        const out = buildHtmlSurfaceSrcDoc(fragment, css)
        expect(out).toContain(fragment)
        expect(out).toContain(css)
    })
})

describe('<HtmlSurface> iframe sandbox', () => {
    // SAFETY CRITICAL: the iframe sandbox must include `allow-scripts`
    // so the embedded resize-observer can post height updates, and
    // must NOT include `allow-same-origin` (combining the two lets
    // the embedded script remove the sandbox attribute on
    // parent.document, neutering the isolation). The original bug
    // had only `allow-same-origin`, which blocked the resize script
    // and pinned every preview at the initial 120px height.
    it('renders an iframe with sandbox="allow-scripts"', () => {
        const container = document.createElement('div')
        document.body.appendChild(container)
        const root = createRoot(container)
        act(() => {
            root.render(React.createElement(HtmlSurface, { html: '<p>x</p>', css: '' }))
        })
        const iframe = container.querySelector('iframe')
        expect(iframe).not.toBeNull()
        const sandbox = iframe!.getAttribute('sandbox') ?? ''
        const tokens = sandbox.split(/\s+/).filter(Boolean)
        expect(tokens).toContain('allow-scripts')
        expect(tokens).not.toContain('allow-same-origin')
        act(() => {
            root.unmount()
        })
        container.remove()
    })
})
