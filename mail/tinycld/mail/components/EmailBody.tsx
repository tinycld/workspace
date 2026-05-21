import { pb } from '@tinycld/core/lib/pocketbase'
import { proxyImageUrls } from '@tinycld/core/lib/proxy-image-urls'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Platform, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { rewriteCidReferences } from './rewrite-cid-references'

interface EmailBodyProps {
    collectionId: string
    recordId: string
    filename: string
    cidMap?: Record<string, string> | null
}

function useEmailHtml(
    collectionId: string,
    recordId: string,
    filename: string,
    cidMap: Record<string, string> | null | undefined
) {
    const [html, setHtml] = useState('')

    useEffect(() => {
        if (!filename) return

        const token = pb.authStore.token
        const url = pb.files.getURL({ collectionId, id: recordId }, filename)
        fetch(url)
            .then((res) => res.text())
            .then((raw) => {
                // Resolve cid: → PB file URL AFTER proxyImageUrls. The proxy
                // wraps remote http(s) <img src> for privacy/auth-token
                // injection but should not re-wrap our own PB-internal
                // attachment URLs — wrapping them sends the request through
                // the image-proxy endpoint which then tries to fetch back
                // from the PB host, breaking under any cross-origin dev
                // setup (Expo on a different port from PB).
                const proxied = proxyImageUrls(raw, token)
                setHtml(rewriteCidReferences(proxied, collectionId, recordId, cidMap))
            })
            .catch(() => setHtml(''))
    }, [collectionId, recordId, filename, cidMap])

    return html
}

function useIframeAutoHeight(html: string) {
    const iframeRef = useRef<HTMLIFrameElement>(null)
    const [height, setHeight] = useState(300)

    const handleLoad = useCallback(() => {
        const doc = iframeRef.current?.contentDocument
        if (!doc) return

        // Prevent infinite resize loop: without this, setting the iframe
        // height to scrollHeight can cause the content to grow to match
        const style = doc.createElement('style')
        style.textContent = `
            html, body { height: auto !important; }
            body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                font-size: 14px;
                line-height: 1.5;
                color: #1f2937;
            }
        `
        doc.head.appendChild(style)

        const updateHeight = () => {
            const scrollH = doc.documentElement.scrollHeight
            const bodyStyle = doc.defaultView?.getComputedStyle(doc.body)
            const marginTop = parseInt(bodyStyle?.marginTop || '0', 10)
            const marginBottom = parseInt(bodyStyle?.marginBottom || '0', 10)
            const h = scrollH + marginTop + marginBottom
            if (h > 0) setHeight(h)
        }

        updateHeight()

        const observer = new ResizeObserver(updateHeight)
        observer.observe(doc.documentElement)
        return () => observer.disconnect()
    }, [])

    // Re-measure when html changes after iframe is already loaded
    // biome-ignore lint/correctness/useExhaustiveDependencies: `html` is the intentional trigger — the effect re-measures the iframe each time the body content changes, but reads the dimensions from the DOM, not from `html` directly
    useEffect(() => {
        const doc = iframeRef.current?.contentDocument
        if (doc?.documentElement) {
            const h = doc.documentElement.scrollHeight
            if (h > 0) setHeight(h)
        }
    }, [html])

    return { iframeRef, height, handleLoad }
}

export function EmailBody({ collectionId, recordId, filename, cidMap }: EmailBodyProps) {
    const html = useEmailHtml(collectionId, recordId, filename, cidMap)
    const { iframeRef, height, handleLoad } = useIframeAutoHeight(html)

    if (!filename) return null

    if (Platform.OS === 'web') {
        return (
            <View className="p-4 flex-1 rounded-lg bg-white">
                <iframe
                    ref={iframeRef}
                    sandbox="allow-same-origin"
                    srcDoc={html}
                    onLoad={handleLoad}
                    style={{
                        border: 'none',
                        width: '100%',
                        height,
                        colorScheme: 'light',
                    }}
                    title="Email body"
                />
            </View>
        )
    }

    return <NativeHtmlBody html={html} />
}

const HEIGHT_REPORTER_SCRIPT = `
(function() {
    function report() {
        // Use scrollHeight on the documentElement: it accounts for collapsed
        // margins and absolutely-positioned content. body.scrollHeight clips
        // when the body has any layout overflow.
        var h = document.documentElement.scrollHeight;
        window.ReactNativeWebView.postMessage(String(h));
    }
    report();
    window.addEventListener('load', report);
    new ResizeObserver(report).observe(document.documentElement);
})();
true;
`

function wrapHtml(body: string): string {
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;height:auto}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2937;padding:16px}img{max-width:100%;height:auto}</style></head><body>${body}</body></html>`
}

function NativeHtmlBody({ html }: { html: string }) {
    // Mirror web's iframe pattern: render the email HTML inside a WebView and
    // let the document report its height back so the surrounding ScrollView
    // (the thread list) handles scrolling, not a nested WebView. Without
    // this, every email becomes its own scrollable region nested in the
    // outer scroll — confusing on touch devices.
    const [height, setHeight] = useState(120)
    const onMessage = useCallback((event: WebViewMessageEvent) => {
        const reported = Number(event.nativeEvent.data)
        if (Number.isFinite(reported) && reported > 0) setHeight(reported)
    }, [])

    if (!html) return <View className="p-4 rounded-lg bg-white" style={{ minHeight: 120 }} />

    return (
        <View className="rounded-lg overflow-hidden bg-white" style={{ height }}>
            <WebView
                originWhitelist={['*']}
                source={{ html: wrapHtml(html) }}
                onMessage={onMessage}
                injectedJavaScript={HEIGHT_REPORTER_SCRIPT}
                javaScriptEnabled
                domStorageEnabled={false}
                scrollEnabled={false}
                showsVerticalScrollIndicator={false}
                style={{ backgroundColor: 'white' }}
            />
        </View>
    )
}
