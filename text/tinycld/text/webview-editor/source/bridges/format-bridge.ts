import type { Editor } from '@tiptap/react'
import { applyCellBorders } from '../../../lib/apply-cell-borders'
import { applyCellShading } from '../../../lib/apply-cell-shading'
import type { CellBorder, CellBorderPreset } from '../../../lib/cell-borders'

// Format bridge for the text WebView. Owns the dispatch of host -> WebView
// command messages that drive TipTap chain calls. Two shapes flow
// through this listener:
//
//   1. TenTap's per-bridge format commands (BoldBridge, ItalicBridge,
//      HeadingBridge, etc.) emit `{ type, payload }` WITHOUT an explicit
//      namespace. The bridge accepts these as-is.
//   2. Our own command messages use `namespace: 'format'` (e.g.
//      insert-table, set-cell-shading, update-image-attrs, set-font-size).
//      The bridge accepts these too.
//
// Messages from other namespaces ('app', 'comment', 'find-replace')
// are deliberately ignored — their own dedicated bridges handle them.
//
// Payload shape conventions vary across types (some are bare scalars
// like `set-text-align`'s `'center'`; others are `{value}` envelopes
// like `set-cell-borders`'s `{preset, border}`). Those are inherited
// from the host-side messaging in `buildWebViewEditorCommands` and
// TenTap's per-bridge emit conventions; the bridge preserves them
// verbatim. A future refactor could normalize the shapes, but that's
// a breaking change separate from this extraction.

interface IncomingMessage {
    namespace?: string
    type?: string
    payload?: unknown
}

type PostToNative = (message: unknown) => void

export interface FormatBridge {
    destroy: () => void
}

// postToNative is accepted but currently unused — the format bridge is
// one-way (host -> WebView). Reserved for future per-command response
// messages without forcing every call site to plumb a poster through.
export function installFormatBridge(
    editor: Editor,
    _postToNative: PostToNative
): FormatBridge {
    function dispatch(parsed: IncomingMessage): void {
        const t = parsed.type
        if (!t) return
        switch (t) {
            case 'toggle-bold':
                editor.chain().focus().toggleBold().run()
                break
            case 'toggle-italic':
                editor.chain().focus().toggleItalic().run()
                break
            case 'toggle-underline':
                editor.chain().focus().toggleUnderline().run()
                break
            // TenTap's BulletListBridge and OrderedListBridge emit
            // camelCase action strings ('toggle-bulletList' /
            // 'toggle-orderedList'), not kebab-case. We must match
            // the exact emitted literal or the message is dropped.
            case 'toggle-bulletList':
                editor.chain().focus().toggleBulletList().run()
                break
            case 'toggle-orderedList':
                editor.chain().focus().toggleOrderedList().run()
                break
            case 'toggle-blockquote':
                editor.chain().focus().toggleBlockquote().run()
                break
            case 'toggle-heading': {
                // TenTap's HeadingBridge sends the level number
                // directly as payload, not wrapped in { level }.
                const level = (parsed.payload as number | undefined) ?? 1
                editor
                    .chain()
                    .focus()
                    .toggleHeading({ level: level as 1 | 2 | 3 })
                    .run()
                break
            }
            case 'set-link': {
                // TenTap's LinkBridge sends { type:'set-link', payload: <string|null> }
                const url = parsed.payload as string | null
                if (url == null) break
                if (url === '') {
                    editor.chain().focus().extendMarkRange('link').unsetLink().run()
                } else {
                    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
                }
                break
            }
            case 'remove-link':
                editor.chain().focus().unsetLink().run()
                break
            case 'undo':
                editor.chain().focus().undo().run()
                break
            case 'redo':
                editor.chain().focus().redo().run()
                break
            case 'set-editable': {
                const next = parsed.payload as boolean
                editor.setEditable(next)
                break
            }
            case 'insert-table': {
                const { rows, cols } = parsed.payload as { rows: number; cols: number }
                editor
                    .chain()
                    .focus()
                    .insertTable({ rows, cols, withHeaderRow: true })
                    .run()
                break
            }
            case 'add-row-before':
                editor.chain().focus().addRowBefore().run()
                break
            case 'add-row-after':
                editor.chain().focus().addRowAfter().run()
                break
            case 'add-column-before':
                editor.chain().focus().addColumnBefore().run()
                break
            case 'add-column-after':
                editor.chain().focus().addColumnAfter().run()
                break
            case 'delete-row':
                editor.chain().focus().deleteRow().run()
                break
            case 'delete-column':
                editor.chain().focus().deleteColumn().run()
                break
            case 'delete-table':
                editor.chain().focus().deleteTable().run()
                break
            case 'merge-cells':
                editor.chain().focus().mergeCells().run()
                break
            case 'split-cell':
                editor.chain().focus().splitCell().run()
                break
            case 'merge-or-split':
                editor.chain().focus().mergeOrSplit().run()
                break
            case 'set-cell-borders': {
                const payload = parsed.payload as {
                    preset: CellBorderPreset
                    border?: Partial<CellBorder>
                }
                editor.commands.focus()
                applyCellBorders(editor, { preset: payload.preset, border: payload.border })
                break
            }
            case 'set-cell-shading': {
                const payload = parsed.payload as { color: string | null }
                editor.commands.focus()
                applyCellShading(editor, payload.color)
                break
            }
            case 'toggle-code':
                editor.chain().focus().toggleCode().run()
                break
            case 'toggle-code-block':
                editor.chain().focus().toggleCodeBlock().run()
                break
            case 'set-text-align': {
                const align = parsed.payload
                if (
                    align === 'left' ||
                    align === 'center' ||
                    align === 'right' ||
                    align === 'justify'
                ) {
                    editor.chain().focus().setTextAlign(align).run()
                }
                break
            }
            case 'unset-text-align':
                editor.chain().focus().unsetTextAlign().run()
                break
            case 'indent-block':
                editor.chain().focus().indentBlock().run()
                break
            case 'outdent-block':
                editor.chain().focus().outdentBlock().run()
                break
            case 'set-font-size': {
                const px = parsed.payload
                if (typeof px === 'number' && Number.isFinite(px) && px > 0) {
                    editor.chain().focus().setFontSize(`${px}px`).run()
                }
                break
            }
            case 'unset-font-size':
                editor.chain().focus().unsetFontSize().run()
                break
            case 'set-font-family': {
                const family = parsed.payload
                if (typeof family === 'string' && family !== '') {
                    editor.chain().focus().setFontFamily(family).run()
                }
                break
            }
            case 'unset-font-family':
                editor.chain().focus().unsetFontFamily().run()
                break
            case 'set-text-color': {
                // payload is a CSS color string (hex, named, rgb()...).
                // Empty / nullish means "clear the override" — for
                // consistency with set-font-size's clear-via-unset shape
                // we also accept '' as an alias for unset.
                const color = parsed.payload
                if (typeof color === 'string' && color !== '') {
                    editor.chain().focus().setColor(color).run()
                } else {
                    editor.chain().focus().unsetColor().run()
                }
                break
            }
            case 'unset-text-color':
                editor.chain().focus().unsetColor().run()
                break
            case 'set-background-color': {
                const bg = parsed.payload
                if (typeof bg === 'string' && bg !== '') {
                    editor.chain().focus().setBackgroundColor(bg).run()
                } else {
                    editor.chain().focus().unsetBackgroundColor().run()
                }
                break
            }
            case 'unset-background-color':
                editor.chain().focus().unsetBackgroundColor().run()
                break
            case 'insert-image': {
                const { src, alt } = parsed.payload as { src: string; alt?: string }
                editor.chain().focus().setImage({ src, alt }).run()
                break
            }
            case 'update-image-attrs': {
                const payload = parsed.payload
                if (payload === null || typeof payload !== 'object') break
                const next: Record<string, unknown> = {}
                const wrap = (payload as { wrap?: unknown }).wrap
                if (
                    wrap === 'left' ||
                    wrap === 'right' ||
                    wrap === 'break' ||
                    wrap === null
                ) {
                    next.wrap = wrap
                }
                const width = (payload as { width?: unknown }).width
                if (typeof width === 'number' && Number.isFinite(width) && width > 0) {
                    next.width = Math.round(width)
                }
                const height = (payload as { height?: unknown }).height
                if (typeof height === 'number' && Number.isFinite(height) && height > 0) {
                    next.height = Math.round(height)
                }
                if (Object.keys(next).length === 0) break
                editor.chain().focus().updateAttributes('image', next).run()
                break
            }
            case 'cut':
                editor.commands.focus()
                document.execCommand('cut')
                break
            case 'copy':
                editor.commands.focus()
                document.execCommand('copy')
                break
            case 'paste':
                // execCommand('paste') is blocked in WebView contexts
                // unless the host grants special permission. Fall
                // back to the async clipboard API and insert via
                // Tiptap so the change rides through one collab tx.
                editor.commands.focus()
                navigator.clipboard
                    ?.readText()
                    .then(text => {
                        if (!text) return
                        editor.chain().focus().insertContent(text).run()
                    })
                    .catch(() => undefined)
                break
            case 'delete-selection':
                editor.chain().focus().deleteSelection().run()
                break
            case 'select-all':
                editor.chain().focus().selectAll().run()
                break
        }
    }

    function onMessage(evt: MessageEvent): void {
        if (typeof evt.data !== 'string') return
        let parsed: IncomingMessage
        try {
            parsed = JSON.parse(evt.data) as IncomingMessage
        } catch {
            return
        }
        // Init messages handled by parent <Editor />. Comment, find-
        // replace, and ui have their own dedicated bridges.
        if (parsed.namespace === 'app') return
        if (parsed.namespace === 'comment') return
        if (parsed.namespace === 'find-replace') return
        if (parsed.namespace === 'ui') return
        dispatch(parsed)
    }

    window.addEventListener('message', onMessage)
    document.addEventListener('message', onMessage as EventListener)

    return {
        destroy: () => {
            window.removeEventListener('message', onMessage)
            document.removeEventListener('message', onMessage as EventListener)
        },
    }
}
