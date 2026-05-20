import type { EditorToolbarState } from './types'

// Narrow an unknown alignment value coming over the WebView bridge into
// the toolbar-state literal type.
function asAlign(v: unknown): EditorToolbarState['currentAlign'] {
    return v === 'left' || v === 'center' || v === 'right' || v === 'justify' ? v : null
}

// Derive the EditorToolbarState shape from the raw bridgeState the
// WebView posts. Lives as a pure helper so it can be unit-tested
// without instantiating a TenTap bridge (the hook itself isn't easily
// rendered under vitest because the in-WebView editor depends on
// react-native + tentap's bridge implementation).
//
// `bridgeState` is the raw object TenTap's useBridgeState returns plus
// any custom fields the in-WebView Editor.tsx posts via stateUpdate. We
// read the custom fields through a loose record view rather than
// extending TenTap's typed surface — the WebView contract is the
// {namespace, type, payload} envelope, not the bridge object.
//
// Narrowing is strict: each field requires the expected runtime type
// (`=== true` for booleans, `typeof === 'number'` for numbers, etc.)
// and falls back to the documented default otherwise. A malformed wire
// value (e.g. `isBoldActive: 'yes'`) collapses to the default rather
// than propagating an unexpected truthy/falsy value to the UI.
export function deriveToolbarState(bridgeState: Record<string, unknown>): EditorToolbarState {
    return {
        isBoldActive: bridgeState.isBoldActive === true,
        isItalicActive: bridgeState.isItalicActive === true,
        isUnderlineActive: bridgeState.isUnderlineActive === true,
        isBulletListActive: bridgeState.isBulletListActive === true,
        isOrderedListActive: bridgeState.isOrderedListActive === true,
        isBlockquoteActive: bridgeState.isBlockquoteActive === true,
        isLinkActive: bridgeState.isLinkActive === true,
        currentLink: typeof bridgeState.activeLink === 'string' ? bridgeState.activeLink : null,
        isInTable: typeof bridgeState.isInTable === 'boolean' ? bridgeState.isInTable : false,
        selectionEmpty:
            typeof bridgeState.selectionEmpty === 'boolean' ? bridgeState.selectionEmpty : true,
        canMergeCells:
            typeof bridgeState.canMergeCells === 'boolean' ? bridgeState.canMergeCells : false,
        canSplitCell:
            typeof bridgeState.canSplitCell === 'boolean' ? bridgeState.canSplitCell : false,
        isCodeActive:
            typeof bridgeState.isCodeActive === 'boolean' ? bridgeState.isCodeActive : false,
        isCodeBlockActive:
            typeof bridgeState.isCodeBlockActive === 'boolean'
                ? bridgeState.isCodeBlockActive
                : false,
        activeHeadingLevel:
            typeof bridgeState.activeHeadingLevel === 'number'
                ? bridgeState.activeHeadingLevel
                : null,
        currentAlign: asAlign(bridgeState.currentAlign),
        canIndent: typeof bridgeState.canIndent === 'boolean' ? bridgeState.canIndent : false,
        canOutdent: typeof bridgeState.canOutdent === 'boolean' ? bridgeState.canOutdent : false,
        currentFontSize:
            typeof bridgeState.currentFontSize === 'number' ? bridgeState.currentFontSize : null,
        currentFontFamily:
            typeof bridgeState.currentFontFamily === 'string'
                ? bridgeState.currentFontFamily
                : null,
        currentTextColor:
            typeof bridgeState.currentTextColor === 'string' ? bridgeState.currentTextColor : null,
        currentBackgroundColor:
            typeof bridgeState.currentBackgroundColor === 'string'
                ? bridgeState.currentBackgroundColor
                : null,
        // Undefined when the in-WebView editor hasn't broadcast a
        // wordCount yet (e.g. non-document editors that don't compute
        // it, or before the initial stateUpdate arrives). The
        // WordCountBadge renders nothing in that case.
        wordCount: typeof bridgeState.wordCount === 'number' ? bridgeState.wordCount : undefined,
    }
}
