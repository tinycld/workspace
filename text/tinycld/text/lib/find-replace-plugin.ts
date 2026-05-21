import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

// A small in-package find/replace plugin. There is no Tiptap search
// extension already in this app's dep graph (no @tiptap/extension-search,
// no prosemirror-search, no tiptap-extension-search-and-replace), and
// rather than adding a third-party dep this implements the minimum
// needed: a plugin-state holding the current query + match offsets, a
// DecorationSet that paints every match with `.text-find-match` (the
// "current" match gets `.text-find-match-active`), and the `findNext`
// / `findPrev` / `replaceCurrent` / `replaceAll` commands the bar
// invokes.
//
// Matching is case-insensitive plain-text substring search across the
// concatenated textContent of the doc, then mapped back to ProseMirror
// positions via a tree walk. Regex / case-sensitive / whole-word are
// deferred to v2.

export interface FindReplacePluginState {
    query: string
    matches: ReadonlyArray<{ from: number; to: number }>
    currentIndex: number
}

interface FindMeta {
    setQuery?: string
    clear?: boolean
    currentIndex?: number
}

export const findReplacePluginKey = new PluginKey<FindReplacePluginState>('text-find-replace')

const EMPTY_STATE: FindReplacePluginState = {
    query: '',
    matches: [],
    currentIndex: 0,
}

// Walk the doc and collect all text positions matching the query.
// Returns positions in document order. Empty/blank queries return [].
function collectMatches(
    doc: EditorState['doc'],
    query: string
): Array<{ from: number; to: number }> {
    if (!query) return []
    const needle = query.toLowerCase()
    const matches: Array<{ from: number; to: number }> = []
    doc.descendants((node, pos) => {
        if (!node.isText || !node.text) return
        const haystack = node.text.toLowerCase()
        let offset = 0
        while (offset <= haystack.length - needle.length) {
            const idx = haystack.indexOf(needle, offset)
            if (idx === -1) break
            matches.push({ from: pos + idx, to: pos + idx + needle.length })
            offset = idx + needle.length
        }
    })
    return matches
}

export function findReplacePlugin(): Plugin<FindReplacePluginState> {
    return new Plugin<FindReplacePluginState>({
        key: findReplacePluginKey,
        state: {
            init: () => EMPTY_STATE,
            apply(tr, prev) {
                const meta: FindMeta | undefined = tr.getMeta(findReplacePluginKey)
                if (meta?.clear) return EMPTY_STATE
                if (meta?.setQuery != null) {
                    const matches = collectMatches(tr.doc, meta.setQuery)
                    return { query: meta.setQuery, matches, currentIndex: 0 }
                }
                if (meta?.currentIndex != null && prev.matches.length > 0) {
                    const len = prev.matches.length
                    const next = ((meta.currentIndex % len) + len) % len
                    return { ...prev, currentIndex: next }
                }
                if (tr.docChanged && prev.query) {
                    const matches = collectMatches(tr.doc, prev.query)
                    const currentIndex = Math.min(prev.currentIndex, Math.max(matches.length - 1, 0))
                    return { ...prev, matches, currentIndex }
                }
                return prev
            },
        },
        props: {
            decorations(state) {
                const pluginState = findReplacePluginKey.getState(state)
                if (!pluginState) return null
                if (pluginState.matches.length === 0) return DecorationSet.empty
                const decos = pluginState.matches.map((match, i) => {
                    const isActive = i === pluginState.currentIndex
                    return Decoration.inline(match.from, match.to, {
                        class: isActive
                            ? 'text-find-match text-find-match-active'
                            : 'text-find-match',
                    })
                })
                return DecorationSet.create(state.doc, decos)
            },
        },
    })
}

// Exported solely for the unit test — exercising the plugin's state
// reducer directly is cleaner than trying to stand up an EditorState
// in node.
export function _applyForTest(
    prev: FindReplacePluginState,
    meta: FindMeta,
    doc: EditorState['doc'] | null,
    docChanged = false
): FindReplacePluginState {
    if (meta.clear) return EMPTY_STATE
    if (meta.setQuery != null && doc != null) {
        const matches = collectMatches(doc, meta.setQuery)
        return { query: meta.setQuery, matches, currentIndex: 0 }
    }
    if (meta.currentIndex != null && prev.matches.length > 0) {
        const len = prev.matches.length
        const next = ((meta.currentIndex % len) + len) % len
        return { ...prev, currentIndex: next }
    }
    if (docChanged && prev.query && doc != null) {
        const matches = collectMatches(doc, prev.query)
        const currentIndex = Math.min(prev.currentIndex, Math.max(matches.length - 1, 0))
        return { ...prev, matches, currentIndex }
    }
    return prev
}

export { collectMatches }

// Imperative helpers the FindReplaceBar invokes via the editor handle.
// They live here so the screen-level component doesn't have to know
// the plugin's meta-key shape.

export interface FindReplaceEditor {
    state: EditorState
    dispatch: (tr: Transaction) => void
}

export function setFindQuery(editor: FindReplaceEditor, query: string): void {
    const tr = editor.state.tr.setMeta(findReplacePluginKey, { setQuery: query } satisfies FindMeta)
    editor.dispatch(tr)
}

export function clearFind(editor: FindReplaceEditor): void {
    const tr = editor.state.tr.setMeta(findReplacePluginKey, { clear: true } satisfies FindMeta)
    editor.dispatch(tr)
}

// Cycles to the next/previous match in a SINGLE transaction so the
// caret + scroll position update atomically with the active-match
// decoration. Two separate dispatches would race: the decoration
// would update on the first tx but the selection would still be on
// the previous match for a frame.
function cycleMatch(editor: FindReplaceEditor, delta: 1 | -1): void {
    const s = findReplacePluginKey.getState(editor.state)
    if (!s || s.matches.length === 0) return
    const len = s.matches.length
    const nextIndex = (((s.currentIndex + delta) % len) + len) % len
    const target = s.matches[nextIndex]
    const tr = editor.state.tr.setMeta(findReplacePluginKey, {
        currentIndex: nextIndex,
    } satisfies FindMeta)
    if (target) {
        tr.setSelection(TextSelection.create(editor.state.doc, target.from, target.to))
        tr.scrollIntoView()
    }
    editor.dispatch(tr)
}

export function findNext(editor: FindReplaceEditor): void {
    cycleMatch(editor, 1)
}

export function findPrev(editor: FindReplaceEditor): void {
    cycleMatch(editor, -1)
}

export function replaceCurrent(editor: FindReplaceEditor, replacement: string): void {
    const s = findReplacePluginKey.getState(editor.state)
    if (!s || s.matches.length === 0) return
    const m = s.matches[s.currentIndex]
    if (!m) return
    const tr = editor.state.tr.insertText(replacement, m.from, m.to)
    editor.dispatch(tr)
}

export function replaceAll(editor: FindReplaceEditor, replacement: string): void {
    const s = findReplacePluginKey.getState(editor.state)
    if (!s || s.matches.length === 0) return
    // Iterate in reverse so earlier match positions stay valid as we
    // splice text in. (Forward iteration would shift every later
    // match by the delta between needle and replacement length.)
    const tr = editor.state.tr
    for (let i = s.matches.length - 1; i >= 0; i--) {
        const m = s.matches[i]
        tr.insertText(replacement, m.from, m.to)
    }
    editor.dispatch(tr)
}
