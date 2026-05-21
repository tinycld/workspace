import {
    type FindReplaceEditor,
    clearFind,
    findNext,
    findPrev,
    findReplacePluginKey,
    replaceAll,
    replaceCurrent,
    setFindQuery,
} from './find-replace-plugin'
import {
    FIND_REPLACE_EMPTY_STATE,
    type FindReplaceController,
} from './find-replace-controller'

// Web FindReplaceController — wraps the in-process Tiptap editor
// returned by use-document-editor.web.tsx. Lives in its own file so the
// import of find-replace-plugin (which pulls @tiptap/pm/view's
// `Decoration` / `DecorationSet`) is only loaded on web. On native the
// plugin module's DOM-touching imports crash at module evaluation, so
// the platform-neutral controller interface in find-replace-controller.ts
// is intentionally kept free of these imports.
export function makeWebFindReplaceController(
    editor: FindReplaceEditor
): FindReplaceController {
    return {
        getState: () => {
            const s = findReplacePluginKey.getState(editor.state)
            if (!s) return FIND_REPLACE_EMPTY_STATE
            return { matchCount: s.matches.length, currentIndex: s.currentIndex, query: s.query }
        },
        setQuery: q => setFindQuery(editor, q),
        clear: () => clearFind(editor),
        next: () => findNext(editor),
        prev: () => findPrev(editor),
        replaceCurrent: r => replaceCurrent(editor, r),
        replaceAll: r => replaceAll(editor, r),
    }
}
