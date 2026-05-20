// On Hermes, `isomorphic-webcrypto` (via `lib0`'s react-native webcrypto
// entrypoint, which yjs pulls in) installs
//   global.document = { attachEvent: () => {} }
// as a tiny shim — see node_modules/msrcrypto/dist/msrcrypto.js lines 37-41.
// That shim makes `typeof document === 'object'` true but leaves
// `document.documentElement` undefined, which breaks `prosemirror-view`'s
// top-level browser sniff:
//   const webkit = !!doc && "webkitFontSmoothing" in doc.documentElement.style
// At module-init that line throws "Cannot read property 'style' of undefined",
// and the throw blows up every module that statically imports anything from
// `@10play/tentap-editor` (mail compose, text documents).
//
// We patch the `document` object in place to add a `documentElement` with
// an empty `style` object whenever something has installed the partial
// shim. The check runs lazily on the first access of `document.documentElement`
// because msrcrypto installs its shim later in the module graph (when yjs
// loads), after this polyfill file evaluates. We install a getter that
// adds `documentElement` on demand.
//
// On web (or any environment with a real DOM) `document` is already an
// object with a real `documentElement`, so we leave it alone.

interface MutableDoc {
    attachEvent?: (...args: unknown[]) => void
    documentElement?: { style?: Record<string, unknown> }
}

const g = globalThis as unknown as { document?: MutableDoc }

function ensureDocumentElement(doc: MutableDoc) {
    if (!doc.documentElement) {
        doc.documentElement = { style: {} }
    } else if (!doc.documentElement.style) {
        doc.documentElement.style = {}
    }
}

if (typeof g.document === 'object' && g.document !== null) {
    ensureDocumentElement(g.document)
} else {
    // Watch for a future assignment to `globalThis.document` (msrcrypto
    // does this lazily on first import of lib0's webcrypto entrypoint).
    // Install a setter that intercepts the assignment and immediately
    // fills in the missing fields.
    let stored: MutableDoc | undefined
    Object.defineProperty(g, 'document', {
        configurable: true,
        get() {
            return stored
        },
        set(value: MutableDoc | undefined) {
            if (value && typeof value === 'object') {
                ensureDocumentElement(value)
            }
            stored = value
        },
    })
}
