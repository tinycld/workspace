export interface EditorHandle {
    getHTML(): Promise<string>
    getText(): Promise<string>
    setContent(html: string): void
    focus(position?: 'start' | 'end'): void
    clear(): void
    // Returns the editor's current selection range in ProseMirror
    // coordinate space, or null if there's no selection or the editor
    // isn't ready. Async because native variants resolve through a
    // request/response message-bus round-trip.
    getSelection(): Promise<{ from: number; to: number } | null>
}

export interface EditorToolbarState {
    isBoldActive: boolean
    isItalicActive: boolean
    isUnderlineActive: boolean
    isBulletListActive: boolean
    isOrderedListActive: boolean
    isBlockquoteActive: boolean
    isLinkActive: boolean
    // True when the caret is inside an inline `code` mark span. Drives
    // the toolbar / menubar inline-code toggle's active state.
    isCodeActive?: boolean
    // True when the caret is inside a codeBlock node. Drives the
    // code-block toggle's active state and gates exit shortcuts.
    isCodeBlockActive?: boolean
    currentLink: string | null
    activeHeadingLevel?: number | null
    isInTable?: boolean
    // True when there's no selected range. Drives Cut/Copy/Delete
    // disabling in the context menu — those operations are no-ops on
    // an empty selection and shouldn't appear interactive.
    selectionEmpty?: boolean
    // Cell-merge capability flags. canMergeCells is true when the
    // current selection spans multiple table cells (a CellSelection
    // from prosemirror-tables) AND the surrounding rectangle is
    // mergeable. canSplitCell is true when the caret sits in a cell
    // with colspan>1 or rowspan>1.
    canMergeCells?: boolean
    canSplitCell?: boolean
    // Active block alignment for the paragraph/heading at the caret,
    // or null when no explicit alignment is set (left — the schema
    // default). Drives the alignment toolbar buttons' active state.
    currentAlign?: 'left' | 'center' | 'right' | 'justify' | null
    // True when the caret/selection is inside an indentable block
    // (paragraph or heading) and the current level is below /
    // above 0 respectively. Drives the indent/outdent button
    // disabling. Undefined when the editor isn't mounted yet.
    canIndent?: boolean
    canOutdent?: boolean
    // Active font size at the caret in integer CSS pixels, or null
    // when no fontSize attr is set (document default). Drives the
    // font-size dropdown's displayed value. The toolbar shows
    // "Default" when the value is null.
    currentFontSize?: number | null
    // Active font family name at the caret, or null when no
    // fontFamily attr is set (document default). Drives the font-
    // family dropdown's displayed value.
    currentFontFamily?: string | null
    // Active text + background color (CSS color string) at the caret,
    // or null when unset. Drives the toolbar color buttons' active-
    // color underline bar.
    currentTextColor?: string | null
    currentBackgroundColor?: string | null
    // Live word count derived from the editor's text content. Optional
    // because non-document editors (mail compose) don't broadcast it.
    // Web variant computes this in the host using the Tiptap editor; native
    // variant receives it in the stateUpdate payload.
    wordCount?: number
}

export interface EditorCommands {
    toggleBold(): void
    toggleItalic(): void
    toggleUnderline(): void
    toggleBulletList(): void
    toggleOrderedList(): void
    toggleBlockquote(): void
    toggleHeading(level: number): void
    // Toggle the inline `code` mark on the current selection (or, when
    // the selection is empty, on subsequent input). Round-trips to a
    // <w:rStyle w:val="VerbatimChar"/> on the OOXML side.
    toggleCode?(): void
    // Toggle the codeBlock node at the caret. Wraps the active
    // paragraph in a code block (or unwraps an existing one back to
    // a paragraph). Round-trips to a paragraph with pStyle="CodeBlock"
    // on the OOXML side.
    toggleCodeBlock?(): void
    setLink(url: string): void
    removeLink(): void
    undo(): void
    redo(): void
    insertTable?(rows: number, cols: number): void
    addRowBefore?(): void
    addRowAfter?(): void
    addColumnBefore?(): void
    addColumnAfter?(): void
    deleteRow?(): void
    deleteColumn?(): void
    deleteTable?(): void
    // Cell merge ops. mergeCells requires a multi-cell selection
    // (shift-drag across cells on web, or a programmatic CellSelection).
    // splitCell undoes a merge on the cell containing the caret.
    // mergeOrSplit is a convenience that picks the right one based on
    // selection — useful when binding both to the same UI affordance.
    mergeCells?(): void
    splitCell?(): void
    mergeOrSplit?(): void
    insertImage?(src: string, alt?: string): void
    // Apply a border preset to the cells in the current table
    // selection. Preset is one of 'all' / 'inner' / 'outer' / 'top' /
    // 'right' / 'bottom' / 'left' / 'horizontal' / 'vertical' / 'none'.
    // Optional border styling overrides the default 1px solid edge.
    setCellBorders?(
        preset:
            | 'all'
            | 'inner'
            | 'outer'
            | 'top'
            | 'right'
            | 'bottom'
            | 'left'
            | 'horizontal'
            | 'vertical'
            | 'none',
        border?: {
            style?: 'none' | 'solid' | 'dashed' | 'dotted' | 'double'
            widthPx?: number
            color?: string | null
        }
    ): void
    // Apply a background color (CSS hex like "#FFFF00") to every cell
    // in the current table selection, or null to clear shading. The
    // value round-trips to <w:tcPr><w:shd w:val="clear" w:color="auto"
    // w:fill="RRGGBB"/></w:tcPr> on the OOXML side.
    setCellShading?(color: string | null): void
    // Clipboard + selection operations. cut/copy/paste rely on a user
    // gesture (a click on a menu item counts) and are dispatched via
    // document.execCommand on web and via the WebView's same DOM on
    // native. deleteSelection removes the current range without
    // touching the system clipboard.
    cut?(): void
    copy?(): void
    paste?(): void
    deleteSelection?(): void
    selectAll?(): void
    // Block alignment. setTextAlign applies one of the four supported
    // values to the paragraph/heading at the caret (or every
    // paragraph/heading in a multi-block selection); unsetTextAlign
    // clears the attribute back to the schema default (left).
    setTextAlign?(align: 'left' | 'center' | 'right' | 'justify'): void
    unsetTextAlign?(): void
    // Block indent. indentBlock bumps the active block's indent attr
    // up by one level; outdentBlock bumps it down. Both clamp at
    // [0, MAX_INDENT_LEVEL] and no-op outside that range.
    indentBlock?(): void
    outdentBlock?(): void
    // Inline font size + family. setFontSize takes the integer CSS
    // pixel value (e.g. 14, 16, 24) and applies a textStyle mark with
    // fontSize=<px>; unsetFontSize clears the attr from the mark.
    // setFontFamily / unsetFontFamily do the same for the family name.
    // The mark coalesces with any existing textStyle attrs (color,
    // fontFamily) on the same run rather than replacing them.
    setFontSize?(px: number): void
    unsetFontSize?(): void
    setFontFamily?(family: string): void
    unsetFontFamily?(): void
    // Inline text + background color. Both accept any CSS color (hex
    // preferred — the DOCX exporter writes hex backgroundColor to
    // <w:shd w:fill="RRGGBB">; non-hex values render in HTML but
    // won't survive a docx round-trip cleanly). Empty string clears
    // the override (same shape as setFontSize/unsetFontSize: callers
    // can use either form).
    setTextColor?(color: string): void
    unsetTextColor?(): void
    setBackgroundColor?(color: string): void
    unsetBackgroundColor?(): void
    // Update the attributes on the currently-selected image. The
    // selection must be a NodeSelection over an image (which the
    // bottom-sheet's open state already gates). Omitted fields are
    // not touched. wrap=null clears the wrap attr back to inline.
    updateImageAttrs?(payload: {
        wrap?: 'left' | 'right' | 'break' | null
        width?: number
        height?: number
    }): void
}

export interface EditorResult {
    editor: EditorHandle
    EditorComponent: React.ComponentType
    commands: EditorCommands
    toolbarState: EditorToolbarState
    // RN WebView ref (native only). Null on web. Host overlay code
    // calls .measure(...) on it to translate the WebView's viewport
    // coords into screen coords for anchored popovers. The type is
    // intentionally opaque (RefObject<unknown>) — callers narrow at
    // the call site (e.g. cast to a shape that has .measure /
    // .postMessage).
    webViewRef?: React.RefObject<unknown> | null
    // Post an arbitrary message to the WebView. Native variants use
    // this to drive WebView-side bridge protocols (e.g. text's
    // 'comment' namespace) that don't have first-class command
    // surfaces on `commands`. Returns false when the WebView isn't
    // mounted yet, or always on web (no WebView to post to).
    postMessage?: (message: import('./message-bus/types').EditorMessage) => boolean
    // Whether the underlying editor (Tiptap web or WebView native) has
    // finished initializing. Web variant resolves true synchronously
    // once the editor mounts; native depends on the WebView's TenTap
    // bridge signal. Consumers should gate UI that depends on a working
    // editor handle (e.g. commentBridge, findReplaceEditor) until this
    // flips true.
    isReady?: boolean
}
