import { createRoot } from 'react-dom/client'
import { Editor } from './Editor'
import { STYLES } from './styles'

declare global {
    interface Window {
        ReactNativeWebView?: { postMessage: (s: string) => void }
        __TEXT_EDITOR_INITIALIZED__?: boolean
    }
}

// Inject styles at runtime. Avoids needing a CSS loader in esbuild; the
// styles end up in a single <style> tag inside the WebView's <head>.
function injectStyles() {
    const style = document.createElement('style')
    style.id = 'tinycld-text-editor-styles'
    style.textContent = STYLES
    document.head.appendChild(style)
}

// One-shot mount. Reentry guard prevents a hot-reload from double-
// initializing the React root inside the WebView.
if (!window.__TEXT_EDITOR_INITIALIZED__) {
    window.__TEXT_EDITOR_INITIALIZED__ = true
    injectStyles()
    const root = document.getElementById('root')
    if (root) {
        createRoot(root).render(<Editor />)
    }
}
