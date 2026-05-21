import {
    BlockquoteBridge,
    BoldBridge,
    BulletListBridge,
    CoreBridge,
    HardBreakBridge,
    HeadingBridge,
    HistoryBridge,
    ItalicBridge,
    LinkBridge,
    OrderedListBridge,
    PlaceholderBridge,
    UnderlineBridge,
} from '@10play/tentap-editor'
import { useAuth } from '@tinycld/core/lib/auth'
import { PB_SERVER_ADDR } from '@tinycld/core/lib/config'
import type { EditorMessage } from '@tinycld/core/lib/editor/message-bus/types'
import { useWebViewEditor } from '@tinycld/core/lib/editor/use-webview-editor'
import { pb } from '@tinycld/core/lib/pocketbase'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import { colorForUser } from '../lib/color-for-user'
import { publishUiMessage } from '../lib/anchored-overlay/ui-message-bus'
import {
    dispatchFindReplaceMessage,
    makeNativeFindReplaceController,
} from '../lib/native-find-replace-controller'
import { useFindReplaceStateStore } from '../lib/stores/find-replace-state-store'
import { useImageSelectionStore } from '../lib/stores/image-selection-store'
import type { ImageSelection } from '../webview-editor/source/editor-state-types'
import { editorHtml } from '../webview-editor/build/editorHtml'
import {
    createNativeCommentBridge,
    createNativeCommentBridgeState,
    dispatchCommentMessage,
} from './native-comment-bridge'
import type { DocumentEditorResult } from './use-document-editor'

export interface UseDocumentEditorOptions {
    yDoc: Y.Doc
    awareness: Awareness
    user?: { name: string; color: string }
    editable?: boolean
    placeholder?: string
    // Required for native: the drive_item id determines the realtime
    // room the WebView's editor connects to. On web, the parent
    // useRealtimeRoom call passes the Y.Doc directly, so this field
    // is unused. On native, we need it because the WebView opens its
    // own realtime connection (its own Y.Doc lives inside the
    // WebView's JS context). When omitted, the WebView shows
    // "Connecting…" forever — useTextDocument is responsible for
    // forwarding it.
    driveItemId?: string
}

// useDocumentEditor (native) — Phase 4. The WebView contains a full
// TipTap+Yjs editor. We hand it credentials (auth token, room id,
// user identity) via the message-bus init payload, and the WebView
// opens its own realtime room connection. The native-side Y.Doc /
// Awareness (passed via options) are NOT bound to this editor — they
// belong to the native-side useTextRoom handle, which surfaces
// serverHello / serverSlot to other native UI (save status indicator,
// readOnly flag).
//
// We register the full set of per-feature TenTap bridges (not just
// CoreBridge). Each bridge's extendEditorInstance hook attaches its
// command method (toggleBold, toggleItalic, setLink, ...) to the
// native-side bridge object. useWebViewEditor's commands call those
// methods, so without the bridges registered, every format button
// throws "bridge.toggleBold is not a function" at runtime.
//
// The bridges' tiptapExtension fields are unused on the WebView side
// (customSource means our in-WebView React app owns its own TipTap
// configuration) — only the native-side message-emit machinery
// matters here. The emitted action-type strings (e.g. 'toggle-bold')
// must match the cases handled in webview-editor/source/Editor.tsx;
// note that TenTap emits camelCase for some list types
// ('toggle-bulletList', 'toggle-orderedList').
export function useDocumentEditor(options: UseDocumentEditorOptions): DocumentEditorResult {
    const { user } = useAuth()
    const userId = user?.id ?? ''
    const userName = user?.name ?? ''
    const userColor = userId ? colorForUser(userId) : '#999'

    const initPayload = useMemo(
        () => ({
            baseURL: String(PB_SERVER_ADDR),
            roomKind: 'text-doc',
            roomId: options.driveItemId ?? '',
            token: pb.authStore.token,
            user: { id: userId, name: userName, color: userColor },
            editable: options.editable ?? true,
            placeholder: options.placeholder,
        }),
        [options.driveItemId, options.editable, options.placeholder, userId, userName, userColor]
    )

    // Push image-selection events from the WebView into the shared
    // store the bottom sheet subscribes to. Every other 'ui' message
    // is fanned out to the ui-message-bus so the anchored-overlay
    // controller (and future subscribers — comments, mentions, …)
    // can consume them without each one having to thread its own
    // onUiMessage prop through the editor stack.
    //
    // Payload-narrowing is done at runtime here (not via a single
    // `as` cast) so that a future selection-kind we don't yet handle
    // (e.g. 'popover', 'comment') falls through silently rather than
    // being mis-coerced to an ImageSelection. The cast on the matched
    // branch is the narrowest possible — just the .image field after
    // we've verified kind === 'image'.
    const onUiMessage = useCallback((message: EditorMessage) => {
        if (message.type === 'selection-changed') {
            const payload = message.payload
            if (payload === null || typeof payload !== 'object') return
            if (!('kind' in payload)) return
            if (payload.kind === 'image' && 'image' in payload) {
                useImageSelectionStore.getState().setSelection(payload.image as ImageSelection)
            } else if (payload.kind === 'none') {
                useImageSelectionStore.getState().setSelection(null)
            }
            return
        }
        // Forward everything else (show-popover, popover-update,
        // popover-exited, future kinds) to the bus. The bus is
        // a process-global publisher so subscribers don't have to
        // reach up through the editor result to find a callback.
        publishUiMessage(message)
    }, [])

    // WebView scroll closes any open anchored popover. Implemented by
    // publishing a synthetic 'popover-dismiss-on-scroll' message into
    // the ui-message-bus that the controller's reducer reduces to a
    // dismiss. iOS RN-WebView doesn't surface in-document scrolls via
    // its `onScroll` when scrollEnabled=false (which TenTap sets), so
    // the WebView source posts a 'document-scroll' message and we
    // re-emit it on the bus here.
    const onScroll = useCallback(() => {
        publishUiMessage({
            namespace: 'ui',
            type: 'popover-dismiss-on-scroll',
            payload: null,
        })
    }, [])

    // Clear the store on unmount so navigating away (or remounting the
    // editor between documents) can't leave the bottom sheet stuck
    // open on a stale selection.
    useEffect(
        () => () => {
            useImageSelectionStore.getState().clearSelection()
        },
        []
    )

    // Clear the find/replace mirror store on unmount for the same
    // reason as image-selection above: switching from doc A (where the
    // user had a query producing "23 matches") to doc B without this
    // cleanup briefly shows doc A's count over doc B's content until
    // the new WebView's initial state-update broadcast lands.
    useEffect(
        () => () => {
            useFindReplaceStateStore.setState({ matchCount: 0, currentIndex: 0, query: '' })
        },
        []
    )

    // Subscriber sets + pending-request maps backing the
    // DocumentCommentBridge. Sets fan out tap/removed events to any
    // number of host handlers; the Maps correlate request/response
    // pairs across the WebView round-trip. Held in a ref because
    // nothing renders off these — they're message-bus plumbing, and
    // re-rendering on every subscribe/unsubscribe would tear down the
    // WebView.
    const commentStateRef = useRef(createNativeCommentBridgeState())

    // Fan-out for 'comment' namespace messages from the WebView. The
    // pure dispatcher in native-comment-bridge.ts handles the per-type
    // routing — narrow + resolve or call handlers.
    const onCommentMessage = useCallback((msg: EditorMessage) => {
        dispatchCommentMessage(commentStateRef.current, msg)
    }, [])

    // Fan-out for 'find-replace' namespace messages from the WebView.
    // The pure dispatcher pushes state-update payloads into the
    // host-side mirror store the FindReplaceBar reads through its
    // controller.
    const onFindReplaceMessage = useCallback((msg: EditorMessage) => {
        dispatchFindReplaceMessage(msg)
    }, [])

    const result = useWebViewEditor({
        editorHtml,
        bridgeExtensions: [
            CoreBridge,
            BoldBridge,
            ItalicBridge,
            UnderlineBridge,
            HeadingBridge,
            BulletListBridge,
            OrderedListBridge,
            BlockquoteBridge,
            LinkBridge,
            HistoryBridge,
            HardBreakBridge,
            PlaceholderBridge,
        ],
        initPayload,
        editable: options.editable ?? true,
        onUiMessage,
        onScroll,
        onCommentMessage,
        onFindReplaceMessage,
    })

    // postMessage isn't ref-stable (it depends on the bridge identity)
    // but we want the commentBridge to be a stable identity across
    // renders. Pin the latest poster behind a ref and read through it
    // inside the bridge methods. Consumers (TextCommentDrawer, the
    // new-comment flow) put the bridge in effect dep arrays — a fresh
    // identity each render would re-subscribe their handlers needlessly.
    const postMessageRef = useRef(result.postMessage)
    postMessageRef.current = result.postMessage

    // Gate the comment bridge on the WebView's TenTap-ready signal.
    // Before isReady flips true the WebView's postMessage either no-ops
    // (no .current ref yet) or its on-message listener inside the
    // WebView hasn't installed — either way, a tap on "+comment" in
    // that window would silently drop the request. Returning null here
    // lets call sites (TextCommentDrawer, the new-comment flow) check
    // `commentBridge != null` and skip / disable the action instead of
    // awaiting a Promise that never resolves.
    const commentBridge = useMemo(
        () => {
            if (!result.isReady) return null
            return createNativeCommentBridge({
                state: commentStateRef.current,
                postMessage: () => postMessageRef.current,
            })
        },
        [result.isReady]
    )

    // Native FindReplaceController. Reads observable state from the
    // host-side mirror store (use-find-replace-state-store.ts) that
    // dispatchFindReplaceMessage populates from the WebView's
    // state-update broadcasts; posts commands across the WebView via
    // result.postMessage. The controller's identity is pinned through
    // a ref-backed poster so it stays stable across renders.
    const findReplaceEditor = useMemo(
        () => makeNativeFindReplaceController(msg => postMessageRef.current?.(msg) ?? false),
        []
    )

    // tiptapEditor is web-only — native delegates editing to the
    // WebView's in-frame ProseMirror, which the host shell has no
    // direct dispatch handle into. commentBridge and findReplaceEditor
    // are now both available on native — they route through their
    // respective WebView namespace protocols.
    return {
        ...result,
        tiptapEditor: null,
        findReplaceEditor,
        commentBridge,
    }
}
