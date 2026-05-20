import { useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'

// envelope wraps the server-rendered fragment in a minimal HTML
// document so the iframe is fully self-contained. The {css} block is
// the surface-specific styling (preview vs print); the {html} body is
// the server-emitted fragment unchanged.
//
// The inline resize-observer at the bottom posts the body's
// scrollHeight back to the parent so we can size the iframe to its
// content. This avoids the alternative of either fixed-height
// scrollable iframes (cramped) or `height: 100vh` (no internal scroll).
const RESIZE_SCRIPT = `<script>
(function(){
    function post() {
        var height = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
        try { parent.postMessage({ type: 'tinycld-html-surface-size', height: height }, '*'); } catch (e) {}
    }
    if (typeof ResizeObserver === 'function') {
        var ro = new ResizeObserver(post);
        ro.observe(document.documentElement);
        ro.observe(document.body);
    }
    window.addEventListener('load', post);
    setTimeout(post, 0);
})();
</script>`

// Exported for unit tests. Composes the envelope the iframe loads.
// Kept as a pure function so tests can assert envelope shape without
// rendering a real iframe.
export function buildHtmlSurfaceSrcDoc(html: string, css: string): string {
    return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}${RESIZE_SCRIPT}</body></html>`
}

export interface HtmlSurfaceProps {
    html: string
    css: string
    ariaLabel?: string
}

// HtmlSurface renders a server-emitted HTML fragment inside a
// sandboxed iframe (web) or a WebView (native). The iframe is
// `sandbox="allow-scripts"` — scripts execute in an opaque origin
// so the embedded resize-observer can post height updates, but the
// document has no access to the parent or its cookies. We
// deliberately do NOT combine `allow-same-origin` with
// `allow-scripts`: per the HTML spec, that combination lets the
// embedded script remove the sandbox attribute from
// `parent.document`, neutering the isolation.
//
// Image URLs in the fragment carry their auth tokens as query-string
// parameters (PocketBase's file-token scheme) which work cross-origin
// without cookies, so the opaque origin doesn't break image loading.
//
// Height tracking: the resize-observer script posts the body's
// scroll height back to the parent. We initialize the iframe at a
// small minimum so it's visible before the first post-message lands.
export function HtmlSurface({ html, css, ariaLabel }: HtmlSurfaceProps) {
    const srcDoc = useMemo(() => buildHtmlSurfaceSrcDoc(html, css), [html, css])
    const [height, setHeight] = useState(120)
    const iframeRef = useRef<HTMLIFrameElement | null>(null)

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            // Sandbox-with-scripts (no allow-same-origin) means
            // event.source is an opaque-origin Window. We can still
            // identity-compare it against iframeRef.current.contentWindow
            // because both pointers refer to the same opaque
            // browsing-context object.
            if (event.source !== iframeRef.current?.contentWindow) return
            const data = event.data as { type?: string; height?: number } | null
            if (!data || data.type !== 'tinycld-html-surface-size') return
            if (typeof data.height !== 'number' || data.height <= 0) return
            setHeight(data.height)
        }
        window.addEventListener('message', handler)
        return () => window.removeEventListener('message', handler)
    }, [])

    return (
        <View className="flex-1 bg-background">
            <iframe
                ref={iframeRef}
                title={ariaLabel ?? 'Rendered content'}
                srcDoc={srcDoc}
                sandbox="allow-scripts"
                aria-label={ariaLabel}
                style={{
                    border: 'none',
                    width: '100%',
                    height: `${height}px`,
                    display: 'block',
                    backgroundColor: 'transparent',
                }}
            />
        </View>
    )
}
