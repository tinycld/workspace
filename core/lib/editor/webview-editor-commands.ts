import type { EditorBridge } from '@10play/tentap-editor'
import { makeMessage } from './message-bus/types'
import type { EditorCommands } from './types'

// Surface the bridge actually needs for our format-message commands —
// the TenTap-native chain calls (toggleBold, undo, ...) plus the
// webviewRef.current.postMessage path sendFormatMessage uses.
// Narrowing here keeps buildWebViewEditorCommands testable against a
// tiny stub rather than the full EditorBridge surface area.
export type WebViewCommandBridge = Pick<
    EditorBridge,
    | 'webviewRef'
    | 'toggleBold'
    | 'toggleItalic'
    | 'toggleUnderline'
    | 'toggleBulletList'
    | 'toggleOrderedList'
    | 'toggleBlockquote'
    | 'toggleHeading'
    | 'setLink'
    | 'undo'
    | 'redo'
>

// TenTap ships no bridges for table or image operations. We forward
// them as messages over the 'format' namespace; the consumer's
// customSource HTML (e.g. text's Editor.tsx) handles them by
// dispatching equivalent TipTap chains. Without this plumbing the
// optional EditorCommands fields would be undefined and toolbar
// buttons calling commands.insertTable?.(...) would silently no-op.
function sendFormatMessage(bridge: WebViewCommandBridge, type: string, payload: unknown): void {
    const webview = bridge.webviewRef?.current
    if (!webview) return
    webview.postMessage(JSON.stringify(makeMessage('format', type, payload)))
}

// Builds the EditorCommands object useWebViewEditor returns. Lives in
// its own module (not inside use-webview-editor.tsx) so unit tests can
// import it without dragging in the rest of the hook — useWebViewEditor
// itself transitively loads @10play/tentap-editor's runtime, which has
// a Node-ESM directory-import bug that breaks vitest's loader. The
// types-only import of `EditorBridge` here is stripped at compile time,
// so vitest never has to resolve the tentap runtime to test this.
export function buildWebViewEditorCommands(bridge: WebViewCommandBridge): EditorCommands {
    return {
        toggleBold: () => bridge.toggleBold(),
        toggleItalic: () => bridge.toggleItalic(),
        toggleUnderline: () => bridge.toggleUnderline(),
        toggleBulletList: () => bridge.toggleBulletList(),
        toggleOrderedList: () => bridge.toggleOrderedList(),
        toggleBlockquote: () => bridge.toggleBlockquote(),
        toggleHeading: (level: number) => bridge.toggleHeading(level as 1 | 2 | 3 | 4 | 5 | 6),
        setLink: (url: string) => bridge.setLink(url),
        removeLink: () => bridge.setLink(''),
        undo: () => bridge.undo(),
        redo: () => bridge.redo(),
        insertTable: (rows: number, cols: number) => {
            sendFormatMessage(bridge, 'insert-table', { rows, cols })
        },
        addRowBefore: () => sendFormatMessage(bridge, 'add-row-before', null),
        addRowAfter: () => sendFormatMessage(bridge, 'add-row-after', null),
        addColumnBefore: () => sendFormatMessage(bridge, 'add-column-before', null),
        addColumnAfter: () => sendFormatMessage(bridge, 'add-column-after', null),
        deleteRow: () => sendFormatMessage(bridge, 'delete-row', null),
        deleteColumn: () => sendFormatMessage(bridge, 'delete-column', null),
        deleteTable: () => sendFormatMessage(bridge, 'delete-table', null),
        mergeCells: () => sendFormatMessage(bridge, 'merge-cells', null),
        splitCell: () => sendFormatMessage(bridge, 'split-cell', null),
        mergeOrSplit: () => sendFormatMessage(bridge, 'merge-or-split', null),
        insertImage: (src: string, alt?: string) =>
            sendFormatMessage(bridge, 'insert-image', { src, alt }),
        setCellBorders: (preset, border) =>
            sendFormatMessage(bridge, 'set-cell-borders', { preset, border }),
        setCellShading: (color: string | null) =>
            sendFormatMessage(bridge, 'set-cell-shading', { color }),
        cut: () => sendFormatMessage(bridge, 'cut', null),
        copy: () => sendFormatMessage(bridge, 'copy', null),
        paste: () => sendFormatMessage(bridge, 'paste', null),
        deleteSelection: () => sendFormatMessage(bridge, 'delete-selection', null),
        selectAll: () => sendFormatMessage(bridge, 'select-all', null),
        toggleCode: () => sendFormatMessage(bridge, 'toggle-code', null),
        toggleCodeBlock: () => sendFormatMessage(bridge, 'toggle-code-block', null),
        setTextAlign: align => sendFormatMessage(bridge, 'set-text-align', align),
        unsetTextAlign: () => sendFormatMessage(bridge, 'unset-text-align', null),
        indentBlock: () => sendFormatMessage(bridge, 'indent-block', null),
        outdentBlock: () => sendFormatMessage(bridge, 'outdent-block', null),
        setFontSize: (px: number) => sendFormatMessage(bridge, 'set-font-size', px),
        unsetFontSize: () => sendFormatMessage(bridge, 'unset-font-size', null),
        setFontFamily: (family: string) => sendFormatMessage(bridge, 'set-font-family', family),
        unsetFontFamily: () => sendFormatMessage(bridge, 'unset-font-family', null),
        setTextColor: (color: string) => sendFormatMessage(bridge, 'set-text-color', color),
        unsetTextColor: () => sendFormatMessage(bridge, 'unset-text-color', null),
        setBackgroundColor: (color: string) =>
            sendFormatMessage(bridge, 'set-background-color', color),
        unsetBackgroundColor: () => sendFormatMessage(bridge, 'unset-background-color', null),
        updateImageAttrs: payload => sendFormatMessage(bridge, 'update-image-attrs', payload),
    }
}
