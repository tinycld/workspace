import { Extension } from '@tiptap/core'
// Side-effect type imports: load the module augmentations from
// `@tiptap/extension-code` and `@tiptap/extension-code-block` so
// `editor.commands.toggleCode` / `toggleCodeBlock` resolve on the
// SingleCommands surface below. The runtime extensions themselves
// are registered through StarterKit in Editor.tsx; these imports
// exist only to anchor the `declare module '@tiptap/core'`
// augmentations that ship inside each extension's .d.ts.
import '@tiptap/extension-code'
import '@tiptap/extension-code-block'
import { NodeSelection } from '@tiptap/pm/state'

// Shared helpers between the WebView's Editor.tsx and the web variant
// (use-document-editor.web.tsx). These are pure, editor-only deriving
// functions that read attributes off whatever Tiptap editor is passed
// in — so they're easy to unit-test against a stubbed editor and
// trivially shareable between the two mounting paths.
//
// The historical location was inside use-document-editor.web.tsx; we
// hoist them here so the WebView entry can load them without dragging
// in the rest of the web hook (drive uploads, theme tokens, slash
// menu, etc.). The WebView and web variants of the same package MUST
// derive identical state so the toolbar lights up consistently.
//
// deriveImageSelection (below) is WebView-only — it reads DOM
// dimensions off the rendered <img> via getBoundingClientRect and
// naturalWidth/naturalHeight, so it expects to run inside the WebView
// where document/HTMLImageElement exist. Tests pass `null` for the
// view parameter to exercise the early-return path without a DOM,
// or a duck-typed stub view to exercise the DOM branch.
//
// Rect coordinate contract: the `rect` field carries the <img>'s
// viewport-coords as returned by getBoundingClientRect (i.e. top/left
// relative to the WebView's currently-visible area), PLUS a snapshot
// of window.scrollX/scrollY at capture time. We deliberately do NOT
// pre-add the scroll values into top/left, because the popover/
// overlay infra on the host needs both pieces of information:
//   - viewport coords answer "where on the visible WebView is the
//     image right now?" — what the host needs to anchor a native
//     popover over a WebView element.
//   - scroll snapshot answers "did the user scroll between when this
//     rect was captured and when we're rendering the overlay?" — the
//     host compares the snapshot to the WebView's current scroll
//     and either re-anchors the overlay or dismisses it.
// Pre-adding the scroll values bakes one fact into the rect and
// destroys the other; keeping them separate preserves both. Hosts
// that need document-coords can compute (top + scrollY, left + scrollX)
// trivially from the broadcast payload.

// EditorLike: the minimum surface the helpers need. Matches both
// `Editor` from @tiptap/react and the return of `useEditor` (which is
// `Editor | null` plus stable identity). Kept structural so tests can
// pass a minimal stub without depending on the heavy Tiptap React
// surface.
export interface EditorLike {
    getAttributes(typeOrName: string): Record<string, unknown>
    isActive(name: string, attrs?: Record<string, unknown>): boolean
}

export type AlignValue = 'left' | 'center' | 'right' | 'justify' | null

// deriveCurrentAlign reads the textAlign attr off whichever indentable
// block the caret is in (paragraph or heading). Returns null when no
// attr is set — the schema default is "left", which we deliberately
// represent as the absence of an attr (matches the DOCX exporter,
// which emits <w:jc> only for non-left values). The toolbar's "Left"
// button uses null as the highlight condition so it appears active by
// default and disengages whenever another alignment is set.
export function deriveCurrentAlign(editor: EditorLike | null | undefined): AlignValue {
    if (!editor) return null
    const fromPara = editor.getAttributes('paragraph')?.textAlign
    const fromHeading = editor.getAttributes('heading')?.textAlign
    const v = fromPara || fromHeading
    if (v === 'center' || v === 'right' || v === 'justify') return v
    if (v === 'left') return 'left'
    return null
}

// deriveCurrentFontSize reads the textStyle.fontSize attr at the caret
// and returns the integer px value, or null when no fontSize is set
// (document default). The Tiptap FontSize extension stores the
// attribute as a CSS length string ("16px"); we parse the integer
// out for the toolbar dropdown. Bare numbers and trailing-unit
// variants ("14") are tolerated for robustness when pasting from
// other sources.
export function deriveCurrentFontSize(editor: EditorLike | null | undefined): number | null {
    if (!editor) return null
    const raw = editor.getAttributes('textStyle')?.fontSize
    if (typeof raw !== 'string' || raw === '') return null
    const trimmed = raw.trim().toLowerCase()
    const numeric = trimmed.endsWith('px') ? trimmed.slice(0, -2).trim() : trimmed
    const n = Number.parseFloat(numeric)
    if (!Number.isFinite(n) || n <= 0) return null
    return Math.round(n)
}

// deriveCurrentFontFamily returns the textStyle.fontFamily attr at the
// caret (already a string in the schema), or null when no family is
// set. Empty strings collapse to null so the toolbar shows "Default"
// rather than a blank selected state.
export function deriveCurrentFontFamily(editor: EditorLike | null | undefined): string | null {
    if (!editor) return null
    const raw = editor.getAttributes('textStyle')?.fontFamily
    if (typeof raw !== 'string' || raw === '') return null
    return raw
}

// deriveCurrentTextColor / deriveCurrentBackgroundColor return the
// textStyle.color / textStyle.backgroundColor attr at the caret, or
// null when unset. The toolbar's color buttons use these to render
// the active-color underline bar under their icons.
export function deriveCurrentTextColor(editor: EditorLike | null | undefined): string | null {
    if (!editor) return null
    const raw = editor.getAttributes('textStyle')?.color
    if (typeof raw !== 'string' || raw === '') return null
    return raw
}

export function deriveCurrentBackgroundColor(
    editor: EditorLike | null | undefined
): string | null {
    if (!editor) return null
    const raw = editor.getAttributes('textStyle')?.backgroundColor
    if (typeof raw !== 'string' || raw === '') return null
    return raw
}

// deriveActiveIndent returns the integer indent attr of the active
// paragraph/heading, clamped non-negative. Returns 0 when the caret
// is not in an indentable block, which keeps canOutdent=false there
// (the buttons should appear disabled, not crash).
export function deriveActiveIndent(editor: EditorLike | null | undefined): number {
    if (!editor) return 0
    const paraAttrs = editor.getAttributes('paragraph')
    const headingAttrs = editor.getAttributes('heading')
    const raw =
        typeof paraAttrs?.indent === 'number'
            ? paraAttrs.indent
            : typeof headingAttrs?.indent === 'number'
              ? headingAttrs.indent
              : 0
    if (!Number.isFinite(raw) || raw < 0) return 0
    return raw
}

// deriveActiveHeadingLevel scans h1..h6 and returns the level of the
// active heading at the caret, or null when none is active. The
// toolbar's heading dropdown uses this to highlight the right level
// (or "Paragraph" when null). Kept as a named helper so it's reusable
// across the WebView Editor and the web variant, and trivially unit-
// testable against an EditorLike stub.
export function deriveActiveHeadingLevel(
    editor: EditorLike | null | undefined
): number | null {
    if (!editor) return null
    for (let level = 1; level <= 6; level++) {
        if (editor.isActive('heading', { level })) return level
    }
    return null
}

// EditorViewLike: the minimum surface deriveImageSelection needs from
// the editor's ProseMirror view. `nodeDOM(pos)` returns the rendered
// DOM node for the node-or-text at the given doc position (or null
// when the doc hasn't been laid out yet). We accept the view as an
// opaque parameter so tests can pass `null` and exercise the
// early-return paths without spinning up a full editor.
export interface EditorViewLike {
    nodeDOM(pos: number): Node | null
}

// EditorWithState: deriveImageSelection needs access to
// editor.state.selection to ask "is the selection a NodeSelection
// over an image node?". Spelled out as a structural interface so the
// test stubs don't have to construct a full Tiptap Editor — they
// build a tiny object whose `state.selection` looks like ProseMirror's
// shape and pass it in.
export interface EditorStateLike {
    selection: unknown
}

export interface EditorWithState {
    state: EditorStateLike
}

// Re-export ImageSelection from a runtime-free sibling. Native consumers
// (use-document-editor.native.tsx, image-selection-store.ts) import it
// directly from editor-state-types so they don't transitively load the
// `@tiptap/*` modules at the top of this file — those crash at module
// evaluation on native.
import type { ImageSelection } from './editor-state-types'
export type { ImageSelection }

// Narrow an unknown attribute value into the legal wrap-mode literals
// the WrappedImage schema accepts. Mirrors WrappedImage's parseHTML
// guard so the broadcast payload's `wrap` field is always one of
// 'left' | 'right' | 'break' | null — no surprise strings ever flow
// through ui.selection-changed.
function asWrapValue(raw: unknown): 'left' | 'right' | 'break' | null {
    if (raw === 'left' || raw === 'right' || raw === 'break') return raw
    return null
}

// Narrow an unknown attribute value into an integer pixel size or null.
// The schema persists width/height as integers; defensive parsing here
// keeps a malformed value (e.g. a string that snuck in via legacy data)
// from blowing up the host's selection store.
function asPositiveInt(raw: unknown): number | null {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null
    return Math.round(raw)
}

// deriveImageSelection inspects the editor's current selection. If it
// is a NodeSelection over an Image node, returns the node's attrs plus
// the rendered <img>'s natural dimensions and a rect describing the
// element's viewport position alongside a snapshot of the WebView's
// scroll offsets at capture time (see ImageSelection above for the
// coordinate-contract rationale). Returns null otherwise (caret in
// text, regular range selection, or no view available).
//
// The host's bottom sheet subscribes to the resulting payload via the
// 'ui' namespace channel and renders wrap-mode chips + preset size
// buttons keyed on whether the natural dimensions are known yet (an
// image whose bytes haven't loaded reports naturalWidth=0; the sheet
// disables size selection in that state).
export function deriveImageSelection(
    editor: EditorWithState | null | undefined,
    view: EditorViewLike | null | undefined
): ImageSelection | null {
    if (!editor) return null
    const selection = editor.state.selection
    if (!(selection instanceof NodeSelection)) return null
    const node = selection.node
    if (!node || node.type?.name !== 'image') return null
    const attrs = (node.attrs ?? {}) as Record<string, unknown>
    const src = typeof attrs.src === 'string' ? attrs.src : ''
    const alt = typeof attrs.alt === 'string' && attrs.alt !== '' ? attrs.alt : null
    const wrap = asWrapValue(attrs.wrap)
    const width = asPositiveInt(attrs.width)
    const height = asPositiveInt(attrs.height)

    let naturalWidth = 0
    let naturalHeight = 0
    let rect: ImageSelection['rect'] = null

    if (view) {
        // selection.from is the position of the node's open token (i.e.
        // its left edge). nodeDOM resolves it to the rendered element
        // — which is the <img> for an inline image. Defensive against
        // either the view returning null (doc not yet laid out) or
        // the resolved node not being an HTMLElement (jsdom edge case).
        const dom = view.nodeDOM(selection.from)
        if (dom instanceof HTMLElement) {
            // Viewport coords from getBoundingClientRect + scroll snapshot
            // from window.scrollX/scrollY. See the file header for the
            // full rationale; tl;dr: do NOT add scroll to top/left here,
            // because the host needs both pieces independently to decide
            // whether to re-anchor or dismiss a popover after the user
            // scrolls between capture and render.
            const box = dom.getBoundingClientRect()
            rect = {
                top: box.top,
                left: box.left,
                width: box.width,
                height: box.height,
                scrollX: typeof window !== 'undefined' ? window.scrollX : 0,
                scrollY: typeof window !== 'undefined' ? window.scrollY : 0,
            }
            if (dom instanceof HTMLImageElement) {
                naturalWidth = dom.naturalWidth || 0
                naturalHeight = dom.naturalHeight || 0
            }
        }
    }

    return {
        src,
        alt,
        wrap,
        width,
        height,
        naturalWidth,
        naturalHeight,
        rect,
    }
}

// CodeShortcuts overrides the StarterKit-bundled keymaps for inline
// `code` and `codeBlock` to the Markdown-style backtick shortcuts.
//   - Mod-` toggles the inline code mark (StarterKit default: Mod-e).
//   - Mod-Shift-` toggles the code block node (StarterKit default:
//     Mod-Alt-c).
// We register on a separate extension so the override is purely
// additive — Tiptap merges multiple extensions' keymaps, so the
// StarterKit defaults still work alongside our additions. The Mod-e
// default is retained for users coming from other Tiptap apps.
export const CodeShortcuts = Extension.create({
    name: 'tinycldCodeShortcuts',
    addKeyboardShortcuts() {
        return {
            'Mod-`': () => this.editor.commands.toggleCode(),
            'Mod-Shift-`': () => this.editor.commands.toggleCodeBlock(),
        }
    },
})
