import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'

// Injected at body end. ResizeObserver posts intrinsic body height
// back through react-native-webview's `window.ReactNativeWebView`
// bridge, which fires onMessage on the JS side. Wrapped in a guard so
// it no-ops in environments without ResizeObserver (older Android
// WebViews) — there we fall back to whatever the WebView reports via
// the load event.
const RESIZE_SCRIPT = `<script>
(function(){
    function post(){
        var height = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
        try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'tinycld-html-surface-size', height: height })); } catch (e) {}
    }
    if (typeof ResizeObserver === 'function') {
        var ro = new ResizeObserver(post);
        ro.observe(document.documentElement);
        ro.observe(document.body);
    }
    window.addEventListener('load', post);
    setTimeout(post, 0);
    true;
})();
</script>`

const ENVELOPE_PREFIX = '<!doctype html><html><head><meta charset="utf-8"><style>'
const ENVELOPE_MID = '</style></head><body>'
const ENVELOPE_SUFFIX = '</body></html>'

function buildHtml(html: string, css: string): string {
    return `${ENVELOPE_PREFIX}${css}${ENVELOPE_MID}${html}${RESIZE_SCRIPT}${ENVELOPE_SUFFIX}`
}

export interface HtmlSurfaceProps {
    html: string
    css: string
    ariaLabel?: string
}

// HtmlSurface (native) renders the same envelope as the web variant
// but inside a react-native-webview. Height tracking uses an injected
// ResizeObserver that posts the document height back over the
// onMessage bridge. JavaScript IS enabled here because the size
// tracking depends on it; the sanitizer strips any <script> tags from
// the server fragment so user content can't run.
export function HtmlSurface({ html, css, ariaLabel }: HtmlSurfaceProps) {
    const source = useMemo(() => ({ html: buildHtml(html, css) }), [html, css])
    const [height, setHeight] = useState(120)

    const onMessage = (event: WebViewMessageEvent) => {
        try {
            const data = JSON.parse(event.nativeEvent.data) as {
                type?: string
                height?: number
            }
            if (data?.type !== 'tinycld-html-surface-size') return
            if (typeof data.height === 'number' && data.height > 0) {
                setHeight(data.height)
            }
        } catch {
            // ignore malformed bridge messages
        }
    }

    return (
        <View className="flex-1 bg-background">
            <WebView
                accessibilityLabel={ariaLabel}
                source={source}
                originWhitelist={['*']}
                scrollEnabled={false}
                onMessage={onMessage}
                style={{ width: '100%', height, backgroundColor: 'transparent' }}
            />
        </View>
    )
}
