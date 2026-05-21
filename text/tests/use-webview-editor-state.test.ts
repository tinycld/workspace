// Verifies that the toolbar-state derivation that backs useWebViewEditor
// surfaces fields the WebView posts in its stateUpdate payload — most
// importantly the Milestone D.1 wordCount field, which feeds the
// WordCountBadge on native.
//
// The hook itself is hard to drive under vitest because the in-WebView
// editor depends on react-native + tentap's bridge implementation (see
// use-webview-editor-commands.test.ts for the same constraint). We
// instead test the pure derivation helper that the hook delegates to —
// deriveToolbarState(bridgeState) — by passing synthetic bridgeState
// objects shaped like what TenTap's useBridgeState would yield after
// receiving the in-WebView Editor's stateUpdate.

import { describe, expect, it } from 'vitest'
import { deriveToolbarState } from '@tinycld/core/lib/editor/derive-toolbar-state'

describe('deriveToolbarState — wordCount', () => {
    it('surfaces wordCount when the bridge state carries a numeric value', () => {
        // The WebView posts wordCount alongside the other toolbar fields
        // in every stateUpdate; the host's useWebViewEditor pipes the
        // bridgeState through this helper, which is what the badge
        // consumes via toolbarState.wordCount.
        const state = deriveToolbarState({ wordCount: 42 })
        expect(state.wordCount).toBe(42)
    })

    it('surfaces a zero count for an empty document', () => {
        // 0 must not be treated as "missing" — typing the first word
        // transitions the badge from "0 words" to "1 word", which is a
        // visible state change for empty docs.
        const state = deriveToolbarState({ wordCount: 0 })
        expect(state.wordCount).toBe(0)
    })

    it('returns undefined when the bridge state has no wordCount field', () => {
        // Mail compose (and any future non-document editor) does not
        // broadcast wordCount. The badge renders nothing in that case,
        // matching the pre-D.1 behavior when the badge consumed a
        // null `editor` prop.
        const state = deriveToolbarState({})
        expect(state.wordCount).toBeUndefined()
    })

    it('returns undefined when wordCount is the wrong type', () => {
        // Defensive: a stray string/null/object on the wire must not
        // confuse the badge into rendering "NaN words" or crashing.
        expect(deriveToolbarState({ wordCount: '42' }).wordCount).toBeUndefined()
        expect(deriveToolbarState({ wordCount: null }).wordCount).toBeUndefined()
        expect(deriveToolbarState({ wordCount: { value: 42 } }).wordCount).toBeUndefined()
    })
})

describe('deriveToolbarState — passes other fields through', () => {
    // Lock the shape of the other fields too so a future refactor that
    // moves wordCount in/out doesn't accidentally rewire the rest of
    // the toolbar state's defaults.
    it('falls back to safe defaults when the bridge state is empty', () => {
        const state = deriveToolbarState({})
        expect(state.isBoldActive).toBe(false)
        expect(state.isItalicActive).toBe(false)
        expect(state.isUnderlineActive).toBe(false)
        expect(state.isLinkActive).toBe(false)
        expect(state.currentLink).toBeNull()
        expect(state.selectionEmpty).toBe(true)
        expect(state.activeHeadingLevel).toBeNull()
        expect(state.currentAlign).toBeNull()
        expect(state.currentFontSize).toBeNull()
        expect(state.currentFontFamily).toBeNull()
    })

    it('forwards toolbar booleans verbatim', () => {
        const state = deriveToolbarState({
            isBoldActive: true,
            isItalicActive: true,
            isCodeBlockActive: true,
        })
        expect(state.isBoldActive).toBe(true)
        expect(state.isItalicActive).toBe(true)
        expect(state.isCodeBlockActive).toBe(true)
    })

    it('narrows currentAlign to the four legal values', () => {
        expect(deriveToolbarState({ currentAlign: 'center' }).currentAlign).toBe('center')
        expect(deriveToolbarState({ currentAlign: 'justify' }).currentAlign).toBe('justify')
        // Unknown alignments collapse to null — the toolbar's default.
        expect(deriveToolbarState({ currentAlign: 'middle' }).currentAlign).toBeNull()
    })
})
