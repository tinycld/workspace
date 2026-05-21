// Unit tests for deriveImageSelection — the helper Editor.tsx uses to
// pull image-selection metadata off the active editor selection and
// emit it on the ui.selection-changed channel. The native bottom
// sheet hangs off the result, so getting the wire shape right is
// load-bearing.
//
// We sidestep needing a full ProseMirror editor by constructing real
// Selection objects (NodeSelection, TextSelection) over a tiny
// document. NodeSelection is exposed from @tiptap/pm/state — the
// same import the production code uses. The first group of tests
// passes a null view (the helper's DOM block is gated on view !==
// null) to exercise the "natural dimensions unknown" path the bottom
// sheet uses to dim its Size buttons before the image loads; the
// second group ("DOM branch") feeds a duck-typed view + stub
// HTMLElement/HTMLImageElement classes installed on globalThis so
// the helper's instanceof checks pass in a plain-node test env.

import { Node, Schema } from '@tiptap/pm/model'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
    deriveImageSelection,
    type EditorViewLike,
    type EditorWithState,
} from '../tinycld/text/webview-editor/source/editor-state'

// Mini-schema shaped like the editor's: a paragraph containing inline
// text + an inline image with the same attrs WrappedImage carries
// (src, alt, wrap, width, height). The image must be inline so it can
// hold a NodeSelection inside a paragraph.
const schema = new Schema({
    nodes: {
        doc: { content: 'block+' },
        paragraph: {
            content: 'inline*',
            group: 'block',
            toDOM: () => ['p', 0],
        },
        text: { group: 'inline' },
        image: {
            inline: true,
            group: 'inline',
            atom: true,
            attrs: {
                src: { default: '' },
                alt: { default: null },
                wrap: { default: null },
                width: { default: null },
                height: { default: null },
            },
            toDOM: () => ['img'],
        },
    },
})

interface BuildDocArgs {
    leadingText?: string
    imageAttrs?: Record<string, unknown>
    trailingText?: string
}

// Build a doc whose only paragraph holds an image flanked (optionally)
// by text. Returns the doc + a starting position for the image node
// so we can construct a NodeSelection that targets it.
function buildDoc(args: BuildDocArgs): { doc: Node; imagePos: number } {
    const {
        leadingText = '',
        imageAttrs = { src: 'https://example/img.png' },
        trailingText = '',
    } = args
    const children: Node[] = []
    if (leadingText) children.push(schema.text(leadingText))
    children.push(schema.nodes.image.create(imageAttrs))
    if (trailingText) children.push(schema.text(trailingText))
    const paragraph = schema.nodes.paragraph.create(null, children)
    const doc = schema.nodes.doc.create(null, [paragraph])
    let imagePos = -1
    doc.descendants((node, pos) => {
        if (node.type === schema.nodes.image && imagePos === -1) {
            imagePos = pos
        }
    })
    return { doc, imagePos }
}

// Build the editor stub deriveImageSelection consumes. The helper
// only ever reads editor.state.selection, so the rest of state can
// stay undefined.
function editorAt(selection: NodeSelection | TextSelection): EditorWithState {
    return { state: { selection } }
}

describe('deriveImageSelection', () => {
    it('returns null when no editor is passed', () => {
        expect(deriveImageSelection(null, null)).toBeNull()
        expect(deriveImageSelection(undefined, null)).toBeNull()
    })

    it('returns null when the selection is a regular text caret', () => {
        const { doc } = buildDoc({ leadingText: 'hello' })
        // TextSelection.create on a doc resolves a position and returns
        // a caret selection — the everyday "user is typing" case.
        const sel = TextSelection.create(doc, 1)
        expect(deriveImageSelection(editorAt(sel), null)).toBeNull()
    })

    it('returns null when the selection is a NodeSelection over a non-image node', () => {
        const { doc } = buildDoc({})
        // NodeSelection.create at position 0 selects the paragraph —
        // a node, but not an image, so the helper must short-circuit.
        const sel = NodeSelection.create(doc, 0)
        expect(deriveImageSelection(editorAt(sel), null)).toBeNull()
    })

    it('returns the image attrs when the selection is a NodeSelection over an image', () => {
        const { doc, imagePos } = buildDoc({
            imageAttrs: {
                src: 'https://example/photo.png',
                alt: 'A photo',
                wrap: 'left',
                width: 300,
                height: 200,
            },
        })
        const sel = NodeSelection.create(doc, imagePos)
        const result = deriveImageSelection(editorAt(sel), null)
        expect(result).not.toBeNull()
        expect(result?.src).toBe('https://example/photo.png')
        expect(result?.alt).toBe('A photo')
        expect(result?.wrap).toBe('left')
        expect(result?.width).toBe(300)
        expect(result?.height).toBe(200)
    })

    it('echoes each of the four legal wrap values (null / left / right / break)', () => {
        for (const wrap of [null, 'left', 'right', 'break'] as const) {
            const { doc, imagePos } = buildDoc({ imageAttrs: { src: 's', wrap } })
            const sel = NodeSelection.create(doc, imagePos)
            const result = deriveImageSelection(editorAt(sel), null)
            expect(result?.wrap).toBe(wrap)
        }
    })

    it('collapses an unknown wrap value to null defensively', () => {
        const { doc, imagePos } = buildDoc({ imageAttrs: { src: 's', wrap: 'mystery' } })
        const sel = NodeSelection.create(doc, imagePos)
        const result = deriveImageSelection(editorAt(sel), null)
        expect(result?.wrap).toBeNull()
    })

    it('treats missing alt as null and an empty string alt as null', () => {
        const cases: { in: unknown; out: string | null }[] = [
            { in: undefined, out: null },
            { in: null, out: null },
            { in: '', out: null },
            { in: 'A photo', out: 'A photo' },
        ]
        for (const c of cases) {
            const { doc, imagePos } = buildDoc({ imageAttrs: { src: 's', alt: c.in } })
            const sel = NodeSelection.create(doc, imagePos)
            const result = deriveImageSelection(editorAt(sel), null)
            expect(result?.alt).toBe(c.out)
        }
    })

    it('reports naturalWidth=0 and rect=null when no view is provided (image not yet rendered)', () => {
        // Production passes editor.view; tests pass null. Same null path
        // also fires in production when the image element hasn't been
        // laid out yet (view.nodeDOM returns null mid-mount). The
        // bottom sheet treats naturalWidth=0 as "Loading image…" and
        // disables the Size section.
        const { doc, imagePos } = buildDoc({ imageAttrs: { src: 's', width: 100 } })
        const sel = NodeSelection.create(doc, imagePos)
        const result = deriveImageSelection(editorAt(sel), null)
        expect(result?.naturalWidth).toBe(0)
        expect(result?.naturalHeight).toBe(0)
        expect(result?.rect).toBeNull()
    })

    it('rounds numeric width/height attrs to integers', () => {
        const { doc, imagePos } = buildDoc({
            imageAttrs: { src: 's', width: 300.6, height: 199.4 },
        })
        const sel = NodeSelection.create(doc, imagePos)
        const result = deriveImageSelection(editorAt(sel), null)
        expect(result?.width).toBe(301)
        expect(result?.height).toBe(199)
    })

    it('treats zero / negative width/height as null', () => {
        const { doc, imagePos } = buildDoc({
            imageAttrs: { src: 's', width: 0, height: -10 },
        })
        const sel = NodeSelection.create(doc, imagePos)
        const result = deriveImageSelection(editorAt(sel), null)
        expect(result?.width).toBeNull()
        expect(result?.height).toBeNull()
    })

    it('returns empty src string when src attr is missing (defensive)', () => {
        // The image node has src: { default: '' } in the schema, so
        // creating with no src lands at empty string. Echoing it
        // verbatim keeps the wire shape stable.
        const { doc, imagePos } = buildDoc({ imageAttrs: {} })
        const sel = NodeSelection.create(doc, imagePos)
        const result = deriveImageSelection(editorAt(sel), null)
        expect(result?.src).toBe('')
    })
})

// DOM-branch coverage. The production code path runs inside a WebView,
// where globalThis.HTMLElement / HTMLImageElement and window exist.
// vitest's default `node` test environment has none of those, and a
// per-file `@vitest-environment` directive doesn't take effect when the
// test file is reached through a sibling-package symlink (which is
// every test in this repo). We instead install stub classes onto
// globalThis ourselves; the helper's `instanceof HTMLElement` /
// `instanceof HTMLImageElement` checks then resolve against those
// stubs. The view parameter is the duck-typed EditorViewLike — its
// only method is nodeDOM(pos) — so we hand-build a tiny stub that
// returns whichever element the test wants for that position.
describe('deriveImageSelection — DOM branch', () => {
    // Hold the originals so we can restore the global state. Even
    // though node's globals are empty here, a future migration to
    // happy-dom would otherwise see this suite scribble over the real
    // browser-like classes.
    let originalHTMLElement: unknown
    let originalHTMLImageElement: unknown
    let originalWindow: unknown

    // Stub bases. The production checks are `instanceof HTMLElement`
    // and `instanceof HTMLImageElement`. Making StubHTMLImageElement
    // extend StubHTMLElement keeps the subtype check honest — a
    // non-image element passes the HTMLElement check but fails the
    // HTMLImageElement check, mirroring the real DOM hierarchy.
    class StubHTMLElement {
        rect: { top: number; left: number; width: number; height: number }
        constructor(rect: { top: number; left: number; width: number; height: number }) {
            this.rect = rect
        }
        getBoundingClientRect() {
            return this.rect
        }
    }
    class StubHTMLImageElement extends StubHTMLElement {
        naturalWidth: number
        naturalHeight: number
        constructor(args: {
            rect: { top: number; left: number; width: number; height: number }
            naturalWidth: number
            naturalHeight: number
        }) {
            super(args.rect)
            this.naturalWidth = args.naturalWidth
            this.naturalHeight = args.naturalHeight
        }
    }

    beforeEach(() => {
        originalHTMLElement = (globalThis as Record<string, unknown>).HTMLElement
        originalHTMLImageElement = (globalThis as Record<string, unknown>).HTMLImageElement
        originalWindow = (globalThis as Record<string, unknown>).window
        ;(globalThis as Record<string, unknown>).HTMLElement = StubHTMLElement
        ;(globalThis as Record<string, unknown>).HTMLImageElement = StubHTMLImageElement
        ;(globalThis as Record<string, unknown>).window = { scrollX: 0, scrollY: 0 }
    })

    afterEach(() => {
        ;(globalThis as Record<string, unknown>).HTMLElement = originalHTMLElement
        ;(globalThis as Record<string, unknown>).HTMLImageElement = originalHTMLImageElement
        ;(globalThis as Record<string, unknown>).window = originalWindow
    })

    function stubView(node: StubHTMLElement | null): EditorViewLike {
        // The production view.nodeDOM(pos) returns a Node | null. Our
        // stub ignores the position because the test sets up exactly
        // one image at the start of the doc; the helper only ever
        // asks for `selection.from`.
        return { nodeDOM: () => node as unknown as globalThis.Node | null }
    }

    it('returns viewport coords plus a scroll snapshot when window has been scrolled', () => {
        // scrollY=120 simulates the user having scrolled the WebView
        // down 120px since the image was rendered. The contract says
        // top/left stay in viewport coords — i.e. they MUST NOT have
        // scroll baked in — and the snapshot captures the scroll
        // values so a Milestone C overlay can decide whether to
        // re-anchor or dismiss.
        ;(globalThis as Record<string, unknown>).window = { scrollX: 0, scrollY: 120 }
        const img = new StubHTMLImageElement({
            rect: { top: 200, left: 50, width: 400, height: 300 },
            naturalWidth: 800,
            naturalHeight: 600,
        })
        const { doc, imagePos } = buildDoc({ imageAttrs: { src: 's' } })
        const sel = NodeSelection.create(doc, imagePos)
        const result = deriveImageSelection(editorAt(sel), stubView(img))
        expect(result?.rect).toEqual({
            top: 200,
            left: 50,
            width: 400,
            height: 300,
            scrollX: 0,
            scrollY: 120,
        })
    })

    it('extracts naturalWidth/Height off the rendered HTMLImageElement', () => {
        // The bottom sheet keys its Size buttons on these — naturalWidth
        // === 0 disables them. The helper reads them only when the DOM
        // node is also an instanceof HTMLImageElement (not just
        // HTMLElement); the next test covers the non-image case.
        const img = new StubHTMLImageElement({
            rect: { top: 0, left: 0, width: 100, height: 50 },
            naturalWidth: 1024,
            naturalHeight: 768,
        })
        const { doc, imagePos } = buildDoc({ imageAttrs: { src: 's' } })
        const sel = NodeSelection.create(doc, imagePos)
        const result = deriveImageSelection(editorAt(sel), stubView(img))
        expect(result?.naturalWidth).toBe(1024)
        expect(result?.naturalHeight).toBe(768)
    })

    it('a non-image HTMLElement (e.g. <div> wrapper) extracts the rect but leaves naturalWidth/Height at 0', () => {
        // A NodeView could in theory wrap the <img> in a styled <div>
        // (the web variant does exactly this for the resize handles).
        // In that case getBoundingClientRect still answers, but
        // naturalWidth/Height belong to the <img>, not the <div>, so
        // the helper must leave them at 0 rather than reading a
        // missing property as NaN/undefined.
        const div = new StubHTMLElement({ top: 10, left: 20, width: 300, height: 200 })
        const { doc, imagePos } = buildDoc({ imageAttrs: { src: 's' } })
        const sel = NodeSelection.create(doc, imagePos)
        const result = deriveImageSelection(editorAt(sel), stubView(div))
        expect(result?.rect).toEqual({
            top: 10,
            left: 20,
            width: 300,
            height: 200,
            scrollX: 0,
            scrollY: 0,
        })
        expect(result?.naturalWidth).toBe(0)
        expect(result?.naturalHeight).toBe(0)
    })

    it('rect is null when nodeDOM returns null (doc not yet laid out), but other fields still populate from attrs', () => {
        // view.nodeDOM(pos) can return null between a doc mutation and
        // the next paint. The helper must not crash, must leave the
        // rect null, and must still produce the editor-attr fields
        // (src, alt, wrap, width, height) so the bottom sheet's wrap
        // chips can still light up correctly without a measured rect.
        const { doc, imagePos } = buildDoc({
            imageAttrs: {
                src: 'https://example/p.png',
                alt: 'caption',
                wrap: 'right',
                width: 250,
                height: 180,
            },
        })
        const sel = NodeSelection.create(doc, imagePos)
        const result = deriveImageSelection(editorAt(sel), stubView(null))
        expect(result?.rect).toBeNull()
        expect(result?.src).toBe('https://example/p.png')
        expect(result?.alt).toBe('caption')
        expect(result?.wrap).toBe('right')
        expect(result?.width).toBe(250)
        expect(result?.height).toBe(180)
        // No DOM node means no natural dimensions either.
        expect(result?.naturalWidth).toBe(0)
        expect(result?.naturalHeight).toBe(0)
    })
})
