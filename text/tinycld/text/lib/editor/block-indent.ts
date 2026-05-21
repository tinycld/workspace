import { Extension } from '@tiptap/core'

// Hard limit on indent depth. Matches MaxIndentLevel in
// server/translate/types.go so importer-clamped values match the
// editor's clamping. The CSS render adds `level * INDENT_PX_PER_LEVEL`
// to the block's inline-start padding, which at the cap (8 * 36 =
// 288 px) leaves roughly half of the 680 px editor canvas for content
// — pushing further than that would crowd the right margin.
export const MAX_INDENT_LEVEL = 8

// Pixels of inline-start padding per indent level. 36 px is a
// compromise between Google Docs (~48 px = 0.5 in) and Notion (~24 px):
// wide enough that one level is visibly distinct from no-indent, narrow
// enough that the cap (8 levels) still leaves usable text width.
export const INDENT_PX_PER_LEVEL = 36

// Tiptap commands surfaced by this extension. indentBlock /
// outdentBlock walk every block-typed range in the current selection
// (so a multi-paragraph selection nudges all of them at once) and
// clamp the resulting level to [0, MAX_INDENT_LEVEL].
declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        blockIndent: {
            indentBlock: () => ReturnType
            outdentBlock: () => ReturnType
        }
    }
}

interface BlockIndentOptions {
    // Node names the indent attribute is added to. We default to
    // paragraph + heading to match the @tiptap/extension-text-align
    // configuration; list items are deliberately excluded — they have
    // their own ProseMirror-level indent via list nesting, and Word's
    // <w:ind w:left> on a list item is uncommon and would complicate
    // the DOCX list round-trip.
    types: string[]
}

// BlockIndent adds an `indent: number` attribute to the configured
// node types and exposes indentBlock / outdentBlock commands plus
// Cmd-]/Cmd-[ keymaps (Google Docs convention).
//
// The attribute renders as `padding-inline-start: ${indent * 36}px`
// inline style so the indent survives a copy-out -> paste-in cycle
// without depending on an external stylesheet. The OOXML round-trip
// (server/translate) reads the same attr and emits <w:ind w:left>
// with 720 twips per level.
export const BlockIndent = Extension.create<BlockIndentOptions>({
    name: 'blockIndent',

    addOptions() {
        return {
            types: ['paragraph', 'heading'],
        }
    },

    addGlobalAttributes() {
        return [
            {
                types: this.options.types,
                attributes: {
                    indent: {
                        default: 0,
                        parseHTML: el => {
                            const attr = el.getAttribute('data-indent')
                            if (attr === null) return 0
                            const n = Number.parseInt(attr, 10)
                            if (!Number.isFinite(n) || n <= 0) return 0
                            return Math.min(n, MAX_INDENT_LEVEL)
                        },
                        renderHTML: attrs => {
                            const level = clampLevel(attrs.indent)
                            if (level === 0) return {}
                            return {
                                'data-indent': String(level),
                                style: `padding-inline-start: ${level * INDENT_PX_PER_LEVEL}px`,
                            }
                        },
                    },
                },
            },
        ]
    },

    addCommands() {
        return {
            indentBlock:
                () =>
                ({ commands, state }) =>
                    adjustIndent(state, this.options.types, commands, +1),
            outdentBlock:
                () =>
                ({ commands, state }) =>
                    adjustIndent(state, this.options.types, commands, -1),
        }
    },

    addKeyboardShortcuts() {
        return {
            'Mod-]': () => this.editor.commands.indentBlock(),
            'Mod-[': () => this.editor.commands.outdentBlock(),
        }
    },
})

// adjustIndent walks every node of one of the configured types
// inside the current selection and bumps its `indent` attr by the
// given delta (+1 / -1), clamped to [0, MAX_INDENT_LEVEL]. Returns
// true when at least one node was updated, so chained commands can
// detect whether the action had any effect.
function adjustIndent(
    state: { selection: { from: number; to: number }; doc: { nodesBetween: NodesBetweenFn } },
    types: string[],
    commands: { updateAttributes: (typeOrName: string, attrs: Record<string, unknown>) => boolean },
    delta: number
): boolean {
    const { from, to } = state.selection
    const typeSet = new Set(types)
    let touched = false
    state.doc.nodesBetween(from, to, node => {
        if (!typeSet.has(node.type.name)) return true
        const current = clampLevel(node.attrs.indent)
        const next = clampLevel(current + delta)
        if (next === current) return false
        // updateAttributes operates on the node at the current
        // selection range — for multi-paragraph selections this means
        // each call walks the whole range and rewrites every block of
        // this type to the same next value. That's the right behaviour
        // for a selection that's already homogeneous; mixed-indent
        // multi-selection is rare enough that the simpler API wins.
        if (commands.updateAttributes(node.type.name, { indent: next })) {
            touched = true
        }
        return false
    })
    return touched
}

function clampLevel(raw: unknown): number {
    let n = 0
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        n = Math.floor(raw)
    } else if (typeof raw === 'string') {
        const parsed = Number.parseInt(raw, 10)
        if (Number.isFinite(parsed)) n = parsed
    }
    if (n < 0) return 0
    if (n > MAX_INDENT_LEVEL) return MAX_INDENT_LEVEL
    return n
}

// nodesBetween's callback signature, pulled out so we can type the
// state shape passed into adjustIndent without depending on
// prosemirror-model's exported types. The actual nodes-between
// signature is (from, to, fn(node, pos, parent, index): false |
// undefined); we only care about `node` here, plus the early-return
// optimisation.
type NodeLike = {
    type: { name: string }
    attrs: { indent?: unknown }
}
type NodesBetweenFn = (
    from: number,
    to: number,
    cb: (node: NodeLike, pos: number) => boolean | undefined
) => void
