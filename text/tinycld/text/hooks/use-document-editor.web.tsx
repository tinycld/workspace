import type {
    EditorCommands,
    EditorHandle,
    EditorToolbarState,
} from '@tinycld/core/lib/editor/types'
import { captureException } from '@tinycld/core/lib/errors'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useCreateDriveItem } from '@tinycld/drive/lib/upload-to-drive'
import { Extension } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { Color } from '@tiptap/extension-color'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import { BackgroundColor } from '@tiptap/extension-text-style/background-color'
import { FontFamily } from '@tiptap/extension-text-style/font-family'
import { FontSize } from '@tiptap/extension-text-style/font-size'
import { EditorContent, ReactNodeViewRenderer, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useMemo, useRef } from 'react'
import { View } from 'react-native'
import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import { buildInsertedImageURL } from '../components/ImageInsertButton'
import { ImageNodeView } from '../components/ImageNodeView.web'
import { applyCellBorders } from '../lib/apply-cell-borders'
import { applyCellShading } from '../lib/apply-cell-shading'
import { BorderedTableCell, BorderedTableHeader } from '../lib/bordered-table-cells'
import { BlockIndent, MAX_INDENT_LEVEL } from '../lib/editor/block-indent'
import { CommentMark, snapshotCommentIds } from '../lib/editor/comment-mark'
import { SlashMenu } from '../lib/editor/slash-menu'
import { EDITOR_CONTENT_STYLES } from '../lib/editor-content-styles'
import { extractImageFilesFromDrop, extractImageFilesFromPaste } from '../lib/extract-image-files'
import { makeWebFindReplaceController } from '../lib/find-replace-controller-web'
import { findReplacePlugin } from '../lib/find-replace-plugin'
import { countWords } from '../lib/word-count'
import {
    CodeShortcuts,
    deriveActiveIndent,
    deriveCurrentAlign,
    deriveCurrentBackgroundColor,
    deriveCurrentFontFamily,
    deriveCurrentFontSize,
    deriveCurrentTextColor,
} from '../webview-editor/source/editor-state'
import type { DocumentEditorResult } from './use-document-editor'
import { createWebCommentBridge } from './web-comment-bridge'

// WrappedImage extends TipTap's default Image with:
//   - inline=true so the node can live inside a paragraph (required
//     by the importer's tree shape: images sit alongside text inside
//     the surrounding paragraph, with `wrap` driving CSS float).
//   - a `wrap` attribute serialized to `data-wrap` on the rendered
//     <img> so editor-content-styles.ts can match img[data-wrap=…]
//     and apply float:left / float:right.
//   - `width` / `height` integer attrs (CSS pixels) that round-trip
//     through OOXML's <wp:extent cx/cy> (EMUs, 9525 EMU/px at 96 DPI).
//     The values render as `width=`/`height=` HTML attributes on the
//     <img> (Tiptap's default behaviour for those attribute names) so
//     they survive a paste / copy / DOM serializer round-trip without
//     needing an inline `style` mirror.
//   - a React NodeView (ImageNodeView) that swaps in drag handles
//     while the image is selected, persisting the new dimensions on
//     pointerup via updateAttributes.
//
// The importer (translate/docx_to_pm.go) reads OOXML wrap modes off
// <wp:anchor> + <wp:positionH><wp:align> and emits wrap=left|right;
// the emitter rewrites the same attr back to ImagePositionFloatLeft/
// FloatRight + ImageWrapSquare on save.
const WrappedImage = Image.extend({
    inline: true,
    group: 'inline',
    addAttributes() {
        return {
            ...this.parent?.(),
            wrap: {
                default: null,
                // Whitelist legal values; absent / unknown / 'inline'
                // all normalize to null, which renderHTML below serializes
                // as absence-of-attribute. See lib/image-wrap-modes.ts
                // for the single source of truth on the legal value set.
                parseHTML: el => {
                    const raw = el.getAttribute('data-wrap')
                    if (raw === 'left' || raw === 'right' || raw === 'break') return raw
                    return null
                },
                renderHTML: attrs => {
                    if (!attrs.wrap) return {}
                    return { 'data-wrap': attrs.wrap as string }
                },
            },
            width: {
                default: null,
                parseHTML: el => {
                    const raw = el.getAttribute('width')
                    if (!raw) return null
                    const n = Number.parseInt(raw, 10)
                    return Number.isFinite(n) && n > 0 ? n : null
                },
                renderHTML: attrs => {
                    if (attrs.width === null || attrs.width === undefined) return {}
                    return { width: String(attrs.width) }
                },
            },
            height: {
                default: null,
                parseHTML: el => {
                    const raw = el.getAttribute('height')
                    if (!raw) return null
                    const n = Number.parseInt(raw, 10)
                    return Number.isFinite(n) && n > 0 ? n : null
                },
                renderHTML: attrs => {
                    if (attrs.height === null || attrs.height === undefined) return {}
                    return { height: String(attrs.height) }
                },
            },
        }
    },
    addNodeView() {
        return ReactNodeViewRenderer(ImageNodeView, { as: 'span' })
    },
})

// Inject the document-editor content stylesheet once per page. Tailwind/
// Uniwind preflight strips browser defaults for h1–h6, ul, ol, a, etc.,
// so without this stylesheet an imported .docx renders as a wall of
// 14px text with no heading hierarchy, list markers, or link styling.
// The rules live in editor-content-styles.ts and are shared with the
// WebView editor used on native.
const EDITOR_STYLE_TAG_ID = 'tinycld-text-editor-styles'
if (typeof document !== 'undefined' && !document.getElementById(EDITOR_STYLE_TAG_ID)) {
    const style = document.createElement('style')
    style.id = EDITOR_STYLE_TAG_ID
    style.textContent = EDITOR_CONTENT_STYLES
    document.head.appendChild(style)
}

export interface UseDocumentEditorOptions {
    // Required: the Collaboration extension (yjs binding via Tiptap's
    // bundled y-tiptap, a fork of y-prosemirror) binds to a
    // Y.XmlFragment named "prosemirror" inside this Y.Doc. Caller must
    // hold the Y.Doc open for the lifetime of the editor.
    yDoc: Y.Doc
    // Required: shared awareness for the same room. Cursor positions
    // and presence info ride on this. Use the `user` option below to
    // set the local user identity for collaboration cursors —
    // CollaborationCaret writes its `user` option into awareness.user
    // on mount, so any pre-mount awareness.setLocalStateField('user', ...)
    // would be clobbered.
    awareness: Awareness
    // Optional: local user identity to display in collaboration cursors
    // (the floating cursor labels other peers see). The CollaborationCaret
    // extension writes this into awareness.user on mount; if omitted,
    // peers see anonymous cursors. An `id` field, if provided, rides
    // along into awareness.user so PresenceAvatars can identify the
    // peer beyond name/color alone.
    user?: { id?: string; name: string; color: string }
    // editable=false renders the editor in read-only mode. Tiptap's
    // editable property can be flipped after mount, but for v1 we set it
    // at construction time (consumers pass `editable: !readOnly` from
    // the room's serverHello).
    editable?: boolean
    // Optional placeholder shown when the doc is empty.
    placeholder?: string
    // Accepted for parity with the native variant; ignored on web,
    // where the parent useRealtimeRoom already passes us a connected
    // Y.Doc.
    driveItemId?: string
    // Invoked by the slash menu's "Image" command. The host owns the
    // file/URL picker + drive upload pipeline and routes the resulting
    // src back through `commands.insertImage`. Optional — when omitted
    // the slash-menu Image entry removes the trigger and inserts
    // nothing.
    onRequestInsertImage?: () => void
}

// FindReplaceExtension wraps the find/replace plugin in a Tiptap
// Extension wrapper so it can sit alongside the other extensions
// declared in useEditor(). The plugin itself lives in
// lib/find-replace-plugin.ts so the screen-level FindReplaceBar can
// drive it directly through the shared PluginKey.
const FindReplaceExtension = Extension.create({
    name: 'tinycldFindReplace',
    addProseMirrorPlugins() {
        return [findReplacePlugin()]
    },
})

// Uploads a pasted/dropped image to drive and invokes onInserted with
// the resulting PocketBase file URL. Fire-and-forget — the paste/drop
// handler returns sync, so any error has to route through
// captureException rather than rejecting up to the caller.
type CreateMutate = ReturnType<typeof useCreateDriveItem>['mutate']

function uploadAndInsertImage(
    file: File,
    mutate: CreateMutate,
    onInserted: (url: string) => void
): void {
    mutate(
        {
            body: file,
            name: file.name || 'pasted-image.png',
            mimeType: file.type || 'image/png',
        },
        {
            onSuccess: result => {
                buildInsertedImageURL('drive_items', result.itemId, result.file)
                    .then(onInserted)
                    .catch(err => captureException('text.pasteImageUpload', err))
            },
            onError: err => captureException('text.pasteImageUpload', err),
        }
    )
}

// useDocumentEditor returns a Tiptap editor configured for collaborative
// .docx-style document editing. The hook MUST be called only after the
// caller has a Y.Doc + Awareness pair from a connected realtime room —
// Tiptap's Collaboration extension cannot be reconfigured after mount.
//
// Web variant: uses @tiptap/react directly (no WebView). Mounts
// <EditorContent /> in the DOM. Companion: use-document-editor.native.tsx
// is a v1 stub showing a "coming soon" placeholder.
export function useDocumentEditor(options: UseDocumentEditorOptions): DocumentEditorResult {
    const placeholderColor = useThemeColor('field-placeholder')
    const primaryColor = useThemeColor('primary')
    const foregroundColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted-foreground')
    const borderColor = useThemeColor('border')
    const linkColor = useThemeColor('link')
    const surfaceSecondaryColor = useThemeColor('surface-secondary')

    // Pasted / dropped images upload through the drive package so the
    // serialized image src is a stable URL into PocketBase — not an
    // 8MB base64 data URI that round-trips through every collaborator's
    // Y.Doc update payload.
    const createDriveItem = useCreateDriveItem()

    // Stash the slash-menu image callback behind a ref so changes in
    // its identity (which happens any time the surrounding screen re-
    // renders) don't force the Tiptap editor to be re-created — that
    // would tear down the Y.Doc binding and reset undo history. The
    // SlashMenu extension reads the callback through a tiny shim closure
    // that always dereferences the latest ref value.
    const onRequestInsertImageRef = useRef(options.onRequestInsertImage)
    onRequestInsertImageRef.current = options.onRequestInsertImage

    const tiptapEditor = useEditor(
        {
            // Tiptap v3's useEditor defaults to NOT re-rendering on every
            // transaction (perf opt-out). Without this flag, toolbarState
            // below freezes at mount-time values — isActive('table'),
            // can().mergeCells(), can().splitCell(), and friends never
            // update as the caret moves, so the toolbar permanently
            // believes you're not in a table. Flip it on so each
            // transaction triggers a re-render and the inline toolbar
            // state stays in sync with the editor.
            shouldRerenderOnTransaction: true,
            editable: options.editable ?? true,
            // Paste / drop handlers: detect image files synchronously
            // and return true to suppress the default paste flow ONLY
            // when at least one image was found. Otherwise return false
            // so a styled-text paste from another tab still works. The
            // upload mutation is async; we fire-and-forget here and
            // insert the resulting URL on resolve. Worst case the user
            // sees a small lag before the image appears — acceptable
            // for v1, and far better than embedding the base64 bytes
            // in every collaborator's Y.Doc.
            editorProps: {
                handlePaste: (_view, event) => {
                    const files = extractImageFilesFromPaste(event)
                    if (files.length === 0) return false
                    for (const file of files) {
                        uploadAndInsertImage(file, createDriveItem.mutate, src => {
                            tiptapEditor?.chain().focus().setImage({ src }).run()
                        })
                    }
                    return true
                },
                handleDrop: (_view, event) => {
                    const files = extractImageFilesFromDrop(event)
                    if (files.length === 0) return false
                    for (const file of files) {
                        uploadAndInsertImage(file, createDriveItem.mutate, src => {
                            tiptapEditor?.chain().focus().setImage({ src }).run()
                        })
                    }
                    return true
                },
            },
            extensions: [
                // StarterKit bundles paragraphs, headings, bold, italic,
                // underline, link, bullet/ordered lists, blockquote, and
                // undo/redo. The Collaboration extension below provides
                // yjs-aware history, so we disable StarterKit's local
                // undoRedo (was named "history" in tiptap v2) to avoid
                // both running. The `link` config flows through to
                // StarterKit's bundled Link extension; do NOT re-import
                // @tiptap/extension-link or @tiptap/extension-underline
                // separately — Tiptap's findDuplicates would warn and
                // duplicate keymaps cause flaky toolbar behavior.
                StarterKit.configure({
                    undoRedo: false,
                    link: { openOnClick: false },
                }),
                // StarterKit bundles the inline `code` mark and `codeBlock`
                // node with default keymaps Mod-e / Mod-Alt-c. We layer a
                // small Extension below that adds the Markdown-style
                // backtick shortcuts (Mod-` / Mod-Shift-`) on top —
                // Tiptap merges keymaps across extensions, so the
                // StarterKit defaults are kept and users get both.
                CodeShortcuts,
                // TextStyle + Color provide the `textStyle` mark with a
                // `color` attribute. The .docx importer maps <w:color> on
                // a run to this mark, so headings/runs that carry an
                // explicit color in Word render with the same color here.
                // FontSize / FontFamily piggyback onto the same textStyle
                // mark; the importer collects <w:sz> and <w:rFonts> into
                // the corresponding attrs in server/translate.
                TextStyle,
                Color,
                BackgroundColor,
                FontSize,
                FontFamily,
                // TextAlign: adds the textAlign attr to paragraph +
                // heading and exposes setTextAlign / unsetTextAlign +
                // Cmd-Shift-L/E/R/J keymaps. List items are excluded
                // (Word's <w:jc> on a list item is uncommon and would
                // complicate the round-trip). defaultAlignment is null
                // so unaligned blocks emit no style attr — matching the
                // DOCX exporter, which writes <w:jc> only for non-left
                // alignment.
                TextAlign.configure({
                    types: ['paragraph', 'heading'],
                    alignments: ['left', 'center', 'right', 'justify'],
                    defaultAlignment: null,
                }),
                // BlockIndent: adds an integer indent level (0..N) to
                // paragraph + heading, plus indentBlock / outdentBlock
                // commands and Cmd-]/Cmd-[ keymaps. CSS renders as
                // padding-inline-start per level (see block-indent.ts).
                BlockIndent.configure({ types: ['paragraph', 'heading'] }),
                Placeholder.configure({ placeholder: options.placeholder ?? 'Start writing…' }),
                // Column resize: Tiptap's TableView mounts a
                // columnResizing plugin that draws drag handles on
                // every cell boundary and writes the dragged width
                // back to the cell's `colwidth` attribute on mouseup.
                // BorderedTableCell extends the upstream TableCell with
                // `...this.parent?.()` so colwidth + colspan + rowspan
                // are preserved — resize state flows through unchanged.
                // cellMinWidth keeps a column from being dragged to 0
                // (which would render as a 1px-wide slice).
                Table.configure({ resizable: true, handleWidth: 5, cellMinWidth: 32 }),
                TableRow,
                BorderedTableHeader,
                BorderedTableCell,
                WrappedImage,
                CommentMark,
                Collaboration.configure({
                    document: options.yDoc,
                    field: 'prosemirror',
                }),
                CollaborationCaret.configure({
                    provider: { awareness: options.awareness },
                    user: options.user,
                }),
                FindReplaceExtension,
                SlashMenu.configure({
                    openImageInsert: () => onRequestInsertImageRef.current?.(),
                }),
            ],
        },
        [options.yDoc, options.awareness, options.user?.name, options.user?.color]
    )

    const editor: EditorHandle = useMemo(
        () => ({
            getHTML: () => Promise.resolve(tiptapEditor?.getHTML() ?? ''),
            getText: () => Promise.resolve(tiptapEditor?.getText() ?? ''),
            setContent: (_html: string) => {
                // No-op on collaborative editors: directly setting content via
                // ProseMirror would trigger a destructive Yjs replace, blowing
                // away every peer's state. Seed the Y.Doc on the server side
                // (e.g. via translate.SeedFromPMJSON) instead.
                if (typeof console !== 'undefined') {
                    // biome-ignore lint/suspicious/noConsole: developer-error guard for a footgun API on collaborative editors
                    console.warn(
                        'useDocumentEditor.setContent is a no-op for collaborative editors; seed the Y.Doc instead'
                    )
                }
            },
            focus: (position?: 'start' | 'end') => {
                if (position === 'start') {
                    tiptapEditor?.chain().focus('start').run()
                } else {
                    tiptapEditor?.chain().focus('end').run()
                }
            },
            clear: () => tiptapEditor?.commands.clearContent(),
            getSelection: () => {
                const selection = tiptapEditor?.state.selection
                if (!selection) return Promise.resolve(null)
                return Promise.resolve({ from: selection.from, to: selection.to })
            },
        }),
        [tiptapEditor]
    )

    const commands: EditorCommands = useMemo(
        () => ({
            toggleBold: () => tiptapEditor?.chain().focus().toggleBold().run(),
            toggleItalic: () => tiptapEditor?.chain().focus().toggleItalic().run(),
            toggleUnderline: () => tiptapEditor?.chain().focus().toggleUnderline().run(),
            toggleBulletList: () => tiptapEditor?.chain().focus().toggleBulletList().run(),
            toggleOrderedList: () => tiptapEditor?.chain().focus().toggleOrderedList().run(),
            toggleBlockquote: () => tiptapEditor?.chain().focus().toggleBlockquote().run(),
            toggleCode: () => tiptapEditor?.chain().focus().toggleCode().run(),
            toggleCodeBlock: () => tiptapEditor?.chain().focus().toggleCodeBlock().run(),
            toggleHeading: (level: number) =>
                tiptapEditor
                    ?.chain()
                    .focus()
                    .toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 })
                    .run(),
            setLink: (url: string) => tiptapEditor?.chain().focus().setLink({ href: url }).run(),
            removeLink: () => tiptapEditor?.chain().focus().unsetLink().run(),
            undo: () => tiptapEditor?.chain().focus().undo().run(),
            redo: () => tiptapEditor?.chain().focus().redo().run(),
            insertTable: (rows: number, cols: number) =>
                tiptapEditor
                    ?.chain()
                    .focus()
                    .insertTable({ rows, cols, withHeaderRow: true })
                    .run(),
            addRowBefore: () => tiptapEditor?.chain().focus().addRowBefore().run(),
            addRowAfter: () => tiptapEditor?.chain().focus().addRowAfter().run(),
            addColumnBefore: () => tiptapEditor?.chain().focus().addColumnBefore().run(),
            addColumnAfter: () => tiptapEditor?.chain().focus().addColumnAfter().run(),
            deleteRow: () => tiptapEditor?.chain().focus().deleteRow().run(),
            deleteColumn: () => tiptapEditor?.chain().focus().deleteColumn().run(),
            deleteTable: () => tiptapEditor?.chain().focus().deleteTable().run(),
            // Merge/split: skip the .focus() that other commands use.
            // chain().focus() resets the editor's selection back to its
            // last text selection (via ProseMirror's domSerializer
            // round-trip), which destroys a CellSelection set by
            // shift-drag. Run the command directly on the existing
            // selection so the multi-cell selection survives the click
            // on the menu item.
            mergeCells: () => tiptapEditor?.chain().mergeCells().run(),
            splitCell: () => tiptapEditor?.chain().splitCell().run(),
            mergeOrSplit: () => tiptapEditor?.chain().mergeOrSplit().run(),
            insertImage: (src: string, alt?: string) =>
                tiptapEditor?.chain().focus().setImage({ src, alt }).run(),
            setCellBorders: (preset, border) => {
                if (!tiptapEditor) return
                tiptapEditor.commands.focus()
                applyCellBorders(tiptapEditor, { preset, border })
            },
            setCellShading: (color: string | null) => {
                if (!tiptapEditor) return
                tiptapEditor.commands.focus()
                applyCellShading(tiptapEditor, color)
            },
            cut: () => {
                tiptapEditor?.commands.focus()
                document.execCommand('cut')
            },
            copy: () => {
                tiptapEditor?.commands.focus()
                document.execCommand('copy')
            },
            paste: () => {
                // execCommand('paste') is blocked in modern browsers
                // outside of dedicated extensions, so reach for the
                // async Clipboard API. Inserting through Tiptap's
                // insertContent keeps the change as a single
                // collaborative transaction.
                tiptapEditor?.commands.focus()
                navigator.clipboard
                    ?.readText()
                    .then(text => {
                        if (!text) return
                        tiptapEditor?.chain().focus().insertContent(text).run()
                    })
                    .catch(() => undefined)
            },
            deleteSelection: () => tiptapEditor?.chain().focus().deleteSelection().run(),
            selectAll: () => tiptapEditor?.chain().focus().selectAll().run(),
            setTextAlign: align => tiptapEditor?.chain().focus().setTextAlign(align).run(),
            unsetTextAlign: () => tiptapEditor?.chain().focus().unsetTextAlign().run(),
            indentBlock: () => tiptapEditor?.chain().focus().indentBlock().run(),
            outdentBlock: () => tiptapEditor?.chain().focus().outdentBlock().run(),
            setFontSize: (px: number) =>
                tiptapEditor?.chain().focus().setFontSize(`${px}px`).run(),
            unsetFontSize: () => tiptapEditor?.chain().focus().unsetFontSize().run(),
            setFontFamily: (family: string) =>
                tiptapEditor?.chain().focus().setFontFamily(family).run(),
            unsetFontFamily: () => tiptapEditor?.chain().focus().unsetFontFamily().run(),
            // setTextColor / setBackgroundColor accept any CSS color
            // (hex preferred — the docx exporter rewrites runs whose
            // textStyle.backgroundColor is a 6-digit hex into <w:shd>;
            // non-hex bg values render in HTML but won't survive docx
            // round-trip cleanly). Empty string clears the override.
            setTextColor: (color: string) => {
                if (!color) {
                    tiptapEditor?.chain().focus().unsetColor().run()
                } else {
                    tiptapEditor?.chain().focus().setColor(color).run()
                }
            },
            unsetTextColor: () => tiptapEditor?.chain().focus().unsetColor().run(),
            setBackgroundColor: (color: string) => {
                if (!color) {
                    tiptapEditor?.chain().focus().unsetBackgroundColor().run()
                } else {
                    tiptapEditor?.chain().focus().setBackgroundColor(color).run()
                }
            },
            unsetBackgroundColor: () =>
                tiptapEditor?.chain().focus().unsetBackgroundColor().run(),
            // Imperative entry point that mirrors what ImageNodeView.web.tsx
            // does on direct user input — exists so the surface matches
            // the WebView/native variant, where the bottom sheet routes
            // user actions through commands.updateImageAttrs?.(...).
            // ImageNodeView's own NodeView chrome continues to call
            // updateAttributes directly; this method is not invoked by
            // existing web UI.
            updateImageAttrs: payload =>
                tiptapEditor?.chain().updateAttributes('image', payload).run(),
        }),
        [tiptapEditor]
    )

    const toolbarState: EditorToolbarState = {
        isBoldActive: tiptapEditor?.isActive('bold') ?? false,
        isItalicActive: tiptapEditor?.isActive('italic') ?? false,
        isUnderlineActive: tiptapEditor?.isActive('underline') ?? false,
        isBulletListActive: tiptapEditor?.isActive('bulletList') ?? false,
        isOrderedListActive: tiptapEditor?.isActive('orderedList') ?? false,
        isBlockquoteActive: tiptapEditor?.isActive('blockquote') ?? false,
        isLinkActive: tiptapEditor?.isActive('link') ?? false,
        isCodeActive: tiptapEditor?.isActive('code') ?? false,
        isCodeBlockActive: tiptapEditor?.isActive('codeBlock') ?? false,
        currentLink: (tiptapEditor?.getAttributes('link')?.href as string) ?? null,
        activeHeadingLevel: ((): number | null => {
            for (let level = 1; level <= 6; level++) {
                if (tiptapEditor?.isActive('heading', { level })) return level
            }
            return null
        })(),
        isInTable: tiptapEditor?.isActive('table') ?? false,
        selectionEmpty: tiptapEditor?.state.selection.empty ?? true,
        // editor.can() runs the command's check predicate without
        // actually dispatching the transaction. For mergeCells that
        // means "is the current selection a CellSelection that spans
        // a mergeable rectangle". For splitCell it means "does the
        // caret sit in a cell with colspan>1 or rowspan>1".
        canMergeCells: tiptapEditor?.can().mergeCells() ?? false,
        canSplitCell: tiptapEditor?.can().splitCell() ?? false,
        currentAlign: deriveCurrentAlign(tiptapEditor),
        // The active block's indent level governs both buttons:
        // canIndent is false at the cap (further nudges would no-op),
        // canOutdent is false at 0 (already flush-left). We read the
        // attr off whichever indentable node type is active so the
        // value stays in sync with the caret as it moves.
        canIndent: deriveActiveIndent(tiptapEditor) < MAX_INDENT_LEVEL,
        canOutdent: deriveActiveIndent(tiptapEditor) > 0,
        currentFontSize: deriveCurrentFontSize(tiptapEditor),
        currentFontFamily: deriveCurrentFontFamily(tiptapEditor),
        currentTextColor: deriveCurrentTextColor(tiptapEditor),
        currentBackgroundColor: deriveCurrentBackgroundColor(tiptapEditor),
        // Word count rides through toolbarState so the WordCountBadge
        // can read it the same way on web and native. Recomputes once
        // per transaction (the editor already rerenders on every tx
        // for the other derived fields — currentFontSize etc. — so the
        // O(N) textContent walk piggybacks on that pass without adding
        // a new rerender path). Undefined when the editor hasn't
        // mounted yet, matching the WebView variant's pre-stateUpdate
        // shape; the badge renders nothing in that case.
        wordCount: tiptapEditor
            ? countWords(tiptapEditor.state.doc.textContent)
            : undefined,
    }

    // findReplaceEditor is the platform-agnostic FindReplaceController
    // the bar reads through. The web variant wraps the in-process
    // Tiptap editor's state + dispatch via a small adapter object
    // (with a getter for `state` so the controller always sees the
    // latest EditorState while keeping its own identity stable across
    // re-renders). The screen mounts this on
    // FindReplaceEditorContext.Provider so the bar resolves it without
    // a prop-drill.
    const findReplaceEditor = useMemo(() => {
        if (!tiptapEditor) return null
        const editor = {
            get state() {
                return tiptapEditor.state
            },
            dispatch: tiptapEditor.view.dispatch.bind(tiptapEditor.view),
        }
        return makeWebFindReplaceController(editor)
    }, [tiptapEditor])

    // Host-side comment surface. Tap and removed events are emitted
    // through small registries kept in refs (subscribers register a
    // callback; the underlying DOM/transaction listeners fan out). The
    // bridge object itself stays stable across re-renders so screen
    // code can pass it to long-lived effects without retriggering them.
    const tapHandlersRef = useRef(new Set<(commentId: string) => void>())
    const removedHandlersRef = useRef(new Set<(commentIds: string[]) => void>())
    const lastCommentIdsRef = useRef<Set<string>>(new Set())

    useEffect(() => {
        if (!tiptapEditor) return
        lastCommentIdsRef.current = snapshotCommentIds(tiptapEditor.state.doc)

        function onTransaction() {
            if (!tiptapEditor) return
            const next = snapshotCommentIds(tiptapEditor.state.doc)
            const removed: string[] = []
            for (const id of lastCommentIdsRef.current) {
                if (!next.has(id)) removed.push(id)
            }
            lastCommentIdsRef.current = next
            if (removed.length === 0) return
            for (const handler of removedHandlersRef.current) {
                handler(removed)
            }
        }

        function onDomClick(evt: Event) {
            const target = evt.target
            if (!(target instanceof Element)) return
            const marked = target.closest('span[data-comment-id]')
            if (!marked) return
            const commentId = marked.getAttribute('data-comment-id')
            if (!commentId) return
            for (const handler of tapHandlersRef.current) {
                handler(commentId)
            }
        }

        tiptapEditor.on('transaction', onTransaction)
        tiptapEditor.view.dom.addEventListener('click', onDomClick)
        return () => {
            tiptapEditor.off('transaction', onTransaction)
            tiptapEditor.view.dom.removeEventListener('click', onDomClick)
        }
    }, [tiptapEditor])

    const commentBridge = useMemo(() => {
        if (!tiptapEditor) return null
        return createWebCommentBridge({
            tiptapEditor,
            tapHandlers: tapHandlersRef.current,
            removedHandlers: removedHandlersRef.current,
        })
    }, [tiptapEditor])

    const EditorComponent = useMemo(
        () =>
            function DocumentEditorContent() {
                return (
                    <View
                        className="flex-1 min-h-[200px] tinycld-document-editor"
                        style={{
                            // @ts-expect-error CSS custom properties for web
                            '--editor-placeholder-color': placeholderColor,
                            '--editor-primary-color': primaryColor,
                            '--editor-foreground': foregroundColor,
                            '--editor-muted': mutedColor,
                            '--editor-border': borderColor,
                            '--editor-link': linkColor,
                            '--editor-placeholder': placeholderColor,
                            '--editor-table-header': surfaceSecondaryColor,
                            // Inline-code and code-block share the same
                            // surface-secondary token Word-style call-out blocks
                            // use; the editor-content-styles.ts var() falls back
                            // to a neutral grey for unstyled contexts.
                            '--editor-code-bg': surfaceSecondaryColor,
                        }}
                    >
                        <EditorContent editor={tiptapEditor} />
                    </View>
                )
            },
        [
            tiptapEditor,
            placeholderColor,
            primaryColor,
            foregroundColor,
            mutedColor,
            borderColor,
            linkColor,
            surfaceSecondaryColor,
        ]
    )

    return {
        editor,
        EditorComponent,
        commands,
        toolbarState,
        // Web's editor has no underlying RN WebView; anchored-popover
        // code paths on web bypass the controller entirely (they render
        // through `SlashMenu.web.tsx` portals instead). Explicit null
        // here makes the difference visible at every type site that
        // pulls `webViewRef` off the result, rather than relying on
        // implicit `undefined`.
        webViewRef: null,
        // Web's editor handle is ready as soon as Tiptap has finished
        // mounting (the editor object is non-null). Native consumers
        // gate the comment bridge on this flag — keeping the contract
        // symmetric means no platform-specific branching at the call site.
        isReady: tiptapEditor != null,
        tiptapEditor: tiptapEditor ?? null,
        findReplaceEditor,
        commentBridge,
    }
}
