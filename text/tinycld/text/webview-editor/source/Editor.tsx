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
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useState } from 'react'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { BorderedTableCell, BorderedTableHeader } from '../../lib/bordered-table-cells'
import { BlockIndent, MAX_INDENT_LEVEL } from '../../lib/editor/block-indent'
import { CommentMark } from '../../lib/editor/comment-mark'
import { SlashMenu } from '../../lib/editor/slash-menu'
import { findReplacePlugin } from '../../lib/find-replace-plugin'
import { countWords } from '../../lib/word-count'
import { installCommentBridge } from './bridges/comment-bridge'
import { installFindReplaceBridge } from './bridges/find-replace-bridge'
import { installFormatBridge } from './bridges/format-bridge'
import {
    CodeShortcuts,
    deriveActiveHeadingLevel,
    deriveActiveIndent,
    deriveCurrentAlign,
    deriveCurrentBackgroundColor,
    deriveCurrentFontFamily,
    deriveCurrentFontSize,
    deriveCurrentTextColor,
    deriveImageSelection,
} from './editor-state'
import { RealtimeClient } from './realtime-client'

// Local extensions declared in this module — kept together so the
// import block stays uninterrupted and the in-line `Extension.create`
// definitions don't sit in the middle of unrelated runtime code.

// Inline image variant carrying a `wrap` attr (left|right|none) on
// the rendered <img> as data-wrap, so editor-content-styles can
// apply float:left / float:right. Matches the shape produced by the
// .docx importer in translate/docx_to_pm.go. See the longer notes in
// the web editor's WrappedImage definition.
const WrappedImage = Image.extend({
    inline: true,
    group: 'inline',
    addAttributes() {
        return {
            ...this.parent?.(),
            wrap: {
                default: null,
                // Whitelist legal values; mirror the web editor's
                // schema exactly. See lib/image-wrap-modes.ts for the
                // single source of truth on the legal value set.
                parseHTML: (el: HTMLElement) => {
                    const raw = el.getAttribute('data-wrap')
                    if (raw === 'left' || raw === 'right' || raw === 'break') return raw
                    return null
                },
                renderHTML: (attrs: { wrap?: string | null }) => {
                    if (!attrs.wrap) return {}
                    return { 'data-wrap': attrs.wrap }
                },
            },
        }
    },
})

// FindReplaceExtension wraps the find/replace plugin in a Tiptap
// Extension wrapper so it can sit alongside the other extensions
// declared in useEditor(). The plugin itself lives in
// lib/find-replace-plugin.ts and is shared with the web editor mount.
// The native FindReplaceBar drives it through the host -> WebView
// 'find-replace' namespace bridge (see bridges/find-replace-bridge.ts).
const FindReplaceExtension = Extension.create({
    name: 'tinycldFindReplace',
    addProseMirrorPlugins() {
        return [findReplacePlugin()]
    },
})

interface InitPayload {
    baseURL: string
    roomKind: string
    roomId: string
    token: string
    user: { id: string; name: string; color: string }
    editable: boolean
    placeholder?: string
}

interface IncomingMessage {
    namespace?: string
    type?: string
    payload?: unknown
}

function postToNative(message: unknown) {
    window.ReactNativeWebView?.postMessage(JSON.stringify(message))
}

// Editor mounts in two stages:
//   1. Wait for the {namespace:'app', type:'init'} message from native
//      with credentials + room id. Until then we render a tiny
//      "Connecting…" placeholder.
//   2. Once we have the init payload, mount the EditorMounted child
//      which constructs the Y.Doc, opens the realtime connection,
//      and configures TipTap.
//
// We post {type:'editor-ready', payload:undefined} as soon as we
// mount so the native side knows we're listening. TenTap's CoreBridge
// (the only bridge we pass to useEditorBridge) treats this as the
// EditorReady signal that flips bridgeState.isReady = true. That's
// the gate useWebViewEditor waits on before posting the init payload.
export function Editor() {
    const [init, setInit] = useState<InitPayload | null>(null)

    useEffect(() => {
        function onMessage(evt: MessageEvent) {
            if (typeof evt.data !== 'string') return
            let parsed: IncomingMessage
            try {
                parsed = JSON.parse(evt.data) as IncomingMessage
            } catch {
                return
            }
            if (parsed.namespace === 'app' && parsed.type === 'init') {
                setInit(parsed.payload as InitPayload)
            }
        }
        window.addEventListener('message', onMessage)
        document.addEventListener('message', onMessage as EventListener)
        postToNative({ type: 'editor-ready', payload: undefined })
        return () => {
            window.removeEventListener('message', onMessage)
            document.removeEventListener('message', onMessage as EventListener)
        }
    }, [])

    if (init == null) {
        return <div style={{ padding: 24, color: '#999' }}>Connecting…</div>
    }

    return <EditorMounted init={init} />
}

interface EditorMountedProps {
    init: InitPayload
}

function EditorMounted({ init }: EditorMountedProps) {
    // Construct Y.Doc + Awareness exactly once per mount. The parent
    // <Editor /> only renders <EditorMounted /> after the init payload
    // arrives, so this is effectively a one-shot construction tied to
    // the init payload's identity.
    const [{ yDoc, awareness }] = useState(() => {
        const doc = new Y.Doc()
        const aw = new Awareness(doc)
        aw.setLocalStateField('user', init.user)
        return { yDoc: doc, awareness: aw }
    })

    useEffect(() => {
        const wsProto = init.baseURL.startsWith('https') ? 'wss' : 'ws'
        const wsBase = init.baseURL.replace(/^https?/, wsProto)
        const url =
            `${wsBase}/api/realtime/${encodeURIComponent(init.roomKind)}/` +
            `${encodeURIComponent(init.roomId)}?token=${encodeURIComponent(init.token)}`
        const client = new RealtimeClient({
            url,
            doc: yDoc,
            awareness,
        })
        client.connect()
        return () => client.destroy()
    }, [yDoc, awareness, init.baseURL, init.roomKind, init.roomId, init.token])

    const editor = useEditor({
        editable: init.editable,
        extensions: [
            StarterKit.configure({
                undoRedo: false,
                link: { openOnClick: false },
            }),
            // See use-document-editor.web.tsx for the rationale — both
            // editor mounts must share the same schema so a doc seeded
            // by one is readable by the other. TextStyle/Color/FontSize/
            // FontFamily share a single textStyle mark on the schema;
            // TextAlign and BlockIndent contribute attrs on paragraph +
            // heading. Without these extensions the WebView's schema
            // diverges from the web schema and attrs written by a web
            // peer would be silently dropped on a native edit.
            TextStyle,
            Color,
            BackgroundColor,
            FontSize,
            FontFamily,
            TextAlign.configure({
                types: ['paragraph', 'heading'],
                alignments: ['left', 'center', 'right', 'justify'],
                defaultAlignment: null,
            }),
            BlockIndent.configure({ types: ['paragraph', 'heading'] }),
            Placeholder.configure({
                placeholder: init.placeholder ?? 'Start writing…',
            }),
            Table.configure({ resizable: true, handleWidth: 5, cellMinWidth: 32 }),
            TableRow,
            BorderedTableHeader,
            BorderedTableCell,
            WrappedImage,
            CommentMark,
            CodeShortcuts,
            FindReplaceExtension,
            // SlashMenu — the `bridge` strategy posts ui.show-popover /
            // popover-update / popover-exited messages out of the
            // WebView so the host's AnchoredOverlayController renders
            // the popover as a Modal positioned over the WebView. The
            // host-side `openImageInsert` action isn't reachable from
            // inside the WebView (the file picker lives at the screen
            // level on native), so we don't wire that option through —
            // the slash-menu Image entry deletes the trigger and
            // inserts nothing on native, matching the web variant's
            // behavior when openImageInsert isn't supplied.
            SlashMenu.configure({ renderStrategy: 'bridge' }),
            Collaboration.configure({ document: yDoc, field: 'prosemirror' }),
            CollaborationCaret.configure({
                provider: { awareness },
                user: init.user,
            }),
        ],
    })

    // Stream toolbar state out to native on every transaction. TenTap's
    // CoreEditorActionType.StateUpdate is the channel useBridgeState
    // consumes — we mirror its shape so the native side's useBridgeState
    // picks up our state. The exact wire type string is 'stateUpdate'
    // (from CoreEditorActionType.StateUpdate).
    //
    // Coalesced with requestAnimationFrame so a burst of transactions
    // (bulk paste, initial Y.Doc sync, undo of a large change) at most
    // produces one stateUpdate per frame. A serialized-payload identity
    // skip further suppresses sends when the toolbar state is unchanged
    // (e.g. remote-only edits that don't move the local selection).
    useEffect(() => {
        if (!editor) return
        let scheduled = false
        let lastSerialized = ''
        // Shadow string for the ui.selection-changed channel. Kept
        // separate from lastSerialized so a typing burst inside text
        // (which churns stateUpdate every frame) doesn't re-broadcast
        // a stable "no image selected" payload on every transaction.
        let lastImageSerialized = ''
        function sendState() {
            if (!editor) return
            const payload = {
                isReady: true,
                editable: editor.isEditable,
                isFocused: editor.isFocused,
                empty: editor.isEmpty,
                selection: {
                    from: editor.state.selection.from,
                    to: editor.state.selection.to,
                },
                isBoldActive: editor.isActive('bold'),
                isItalicActive: editor.isActive('italic'),
                isUnderlineActive: editor.isActive('underline'),
                isBulletListActive: editor.isActive('bulletList'),
                isOrderedListActive: editor.isActive('orderedList'),
                isBlockquoteActive: editor.isActive('blockquote'),
                isLinkActive: editor.isActive('link'),
                activeLink: (editor.getAttributes('link')?.href as string) ?? null,
                isInTable: editor.isActive('table'),
                selectionEmpty: editor.state.selection.empty,
                canMergeCells: editor.can().mergeCells(),
                canSplitCell: editor.can().splitCell(),
                isCodeActive: editor.isActive('code'),
                isCodeBlockActive: editor.isActive('codeBlock'),
                activeHeadingLevel: deriveActiveHeadingLevel(editor),
                currentAlign: deriveCurrentAlign(editor),
                canIndent: deriveActiveIndent(editor) < MAX_INDENT_LEVEL,
                canOutdent: deriveActiveIndent(editor) > 0,
                currentFontSize: deriveCurrentFontSize(editor),
                currentFontFamily: deriveCurrentFontFamily(editor),
                currentTextColor: deriveCurrentTextColor(editor),
                currentBackgroundColor: deriveCurrentBackgroundColor(editor),
                // Broadcast the live word count alongside every other
                // toolbar state field. The rAF-coalesce + identity-skip
                // already throttle this; doc.textContent is O(N) over
                // doc text which matches the web variant's per-update
                // cost. Native consumer surfaces this as
                // toolbarState.wordCount via useWebViewEditor's loose-
                // state read.
                wordCount: countWords(editor.state.doc.textContent),
            }
            const serialized = JSON.stringify({ type: 'stateUpdate', payload })
            if (serialized !== lastSerialized) {
                lastSerialized = serialized
                window.ReactNativeWebView?.postMessage(serialized)
            }

            // Broadcast image selection on the 'ui' namespace. The
            // host's native-side bottom sheet subscribes to this and
            // opens whenever payload.kind === 'image'. Kept outside the
            // stateUpdate payload so image-related UI concerns don't
            // contaminate the toolbar's bridge state shape.
            const imageSel = deriveImageSelection(editor, editor.view)
            const imageMsg = JSON.stringify({
                namespace: 'ui',
                type: 'selection-changed',
                payload: imageSel
                    ? { kind: 'image', image: imageSel }
                    : { kind: 'none' },
            })
            if (imageMsg !== lastImageSerialized) {
                lastImageSerialized = imageMsg
                window.ReactNativeWebView?.postMessage(imageMsg)
            }
        }
        function schedule() {
            if (scheduled) return
            scheduled = true
            requestAnimationFrame(() => {
                scheduled = false
                sendState()
            })
        }
        schedule()
        editor.on('transaction', schedule)
        editor.on('focus', schedule)
        editor.on('blur', schedule)
        return () => {
            editor.off('transaction', schedule)
            editor.off('focus', schedule)
            editor.off('blur', schedule)
        }
    }, [editor])

    // Format command messages: TenTap's per-bridge commands (toggle-bold,
    // toggle-heading, etc.) emit { type, payload } without an explicit
    // namespace; our own command messages use namespace 'format' (insert-
    // table, set-cell-shading, update-image-attrs, ...). Both shapes flow
    // through installFormatBridge — mirrors the install pattern of the
    // comment and find-replace bridges.
    useEffect(() => {
        if (!editor) return
        const bridge = installFormatBridge(editor, postToNative)
        return () => bridge.destroy()
    }, [editor])

    useEffect(() => {
        if (!editor) return
        const bridge = installCommentBridge(editor, postToNative)
        return () => bridge.destroy()
    }, [editor])

    useEffect(() => {
        if (!editor) return
        const bridge = installFindReplaceBridge(editor, postToNative)
        return () => bridge.destroy()
    }, [editor])

    // Forward in-document scroll events out to the host. The host's
    // useWebViewEditor receives this on its 'ui' namespace channel and
    // fires its onScroll callback, which the native variant uses to
    // dismiss any open anchored popover (slash menu, future popovers).
    //
    // iOS RN-WebView's own `onScroll` doesn't fire for in-document
    // scrolling when scrollEnabled=false (which TenTap sets), so the
    // signal has to come from the WebView's document. Coalesced via
    // rAF so a smooth scroll doesn't flood the message bus.
    useEffect(() => {
        let scheduled = false
        function onScroll() {
            if (scheduled) return
            scheduled = true
            requestAnimationFrame(() => {
                scheduled = false
                postToNative({
                    namespace: 'ui',
                    type: 'document-scroll',
                    payload: null,
                })
            })
        }
        window.addEventListener('scroll', onScroll, { passive: true })
        // Some Tiptap scroll containers nest the scrolling viewport
        // inside .ProseMirror rather than at window level. Capture
        // scroll events from any element so the dismiss policy fires
        // regardless of which container actually scrolls.
        document.addEventListener('scroll', onScroll, { passive: true, capture: true })
        return () => {
            window.removeEventListener('scroll', onScroll)
            document.removeEventListener('scroll', onScroll, true)
        }
    }, [])

    return <EditorContent editor={editor} />
}
