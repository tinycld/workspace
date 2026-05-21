// Local mirror of the ProseMirror JSON shape used by the editor and by
// the OOXML translator at server/translate/types.go. The translators in
// this directory (md-to-pm.ts, pm-to-md.ts) build / consume trees that
// match this shape exactly so the rest of the editor pipeline
// (insertContent, getJSON) can handle them without conversion.
//
// Node and mark type-name constants below MUST stay in lock-step with
// the Go constants in server/translate/types.go — the .docx round-trip
// asserts the same strings on both sides.

export interface PMNode {
    type: string
    attrs?: Record<string, unknown>
    content?: PMNode[]
    text?: string
    marks?: PMMark[]
}

export interface PMMark {
    type: string
    attrs?: Record<string, unknown>
}

export const NODE_DOC = 'doc'
export const NODE_PARAGRAPH = 'paragraph'
export const NODE_HEADING = 'heading'
export const NODE_BULLET_LIST = 'bulletList'
export const NODE_ORDERED_LIST = 'orderedList'
export const NODE_LIST_ITEM = 'listItem'
export const NODE_BLOCKQUOTE = 'blockquote'
export const NODE_CODE_BLOCK = 'codeBlock'
export const NODE_TABLE = 'table'
export const NODE_TABLE_ROW = 'tableRow'
export const NODE_TABLE_CELL = 'tableCell'
export const NODE_IMAGE = 'image'
export const NODE_TEXT = 'text'
export const NODE_PAGE_BREAK = 'pageBreak'

export const MARK_BOLD = 'bold'
export const MARK_ITALIC = 'italic'
export const MARK_CODE = 'code'
export const MARK_LINK = 'link'
