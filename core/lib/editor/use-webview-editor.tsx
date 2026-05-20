import {
    type BridgeExtension,
    type EditorBridge,
    useBridgeState,
    useEditorBridge,
} from '@10play/tentap-editor'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import type { WebViewMessageEvent } from 'react-native-webview'
import { deriveToolbarState } from './derive-toolbar-state'
import { type EditorMessage, makeMessage } from './message-bus/types'
import type { EditorCommands, EditorHandle, EditorResult } from './types'
import { buildWebViewEditorCommands } from './webview-editor-commands'

export interface UseWebViewEditorOptions {
    // The pre-built HTML string that hosts the in-WebView editor.
    // Produced by a package-specific build step calling
    // bundleWebViewEditor. The string contains a TipTap-React instance
    // configured with whatever extensions the package wants.
    editorHtml: string

    // TenTap bridges for native<->WebView command routing. These are
    // the standard ones (BoldBridge, ItalicBridge, ...) plus any
    // package-specific bridges. They run on the native side; their
    // counterpart TipTap extensions live inside the WebView (compiled
    // into editorHtml).
    bridgeExtensions: BridgeExtension[]

    // App-specific init payload posted into the WebView once it
    // signals EditorReady. Typed as unknown because each package
    // chooses what to send (auth token, room id, user identity, ...).
    // The in-WebView Editor.tsx parses it via JSON.parse.
    initPayload: unknown

    // Forwarded to TenTap's bridge.setEditable. Toggles whether the
    // editor accepts user input; consumers also use this to disable
    // their toolbar UI.
    editable: boolean

    // Forwarded to useEditorBridge for things like webview
    // background color, etc. Optional.
    theme?: Record<string, unknown>

    // Optional TenTap-level avoidIosKeyboard flag. Defaults to true.
    avoidIosKeyboard?: boolean

    // Optional initial content (HTML). Most consumers won't set this
    // because the editor populates itself from the Y.Doc bootstrap.
    initialContent?: string

    // Whether the WebView contains its own scroll behavior. Pass false
    // when the editor is embedded inside an outer ScrollView (e.g. mail
    // compose); pass true when the editor is the scroll surface (e.g.
    // text document edit). Defaults to true.
    scrollEnabled?: boolean

    // Subscribe to messages with the 'ui' namespace from the WebView.
    // Called for every parsable message whose namespace === 'ui'; the
    // payload shape depends on the message type and is the consumer's
    // responsibility to interpret. TenTap's built-in messages (state
    // updates, core action responses) still flow through their own
    // channel via bridgeExtensions — we don't intercept those.
    //
    // The callback identity is read through a ref, so the consumer
    // doesn't have to memoize it.
    onUiMessage?: (message: EditorMessage) => void

    // Called when the WebView reports an in-document scroll event from
    // its injected scroll listener. Anchored popovers rendered by the
    // host (slash menu, future image/comment popovers) subscribe to
    // this and dismiss themselves so the overlay doesn't drift away
    // from the anchored element when the user scrolls. iOS RN-WebView's
    // own `onScroll` does not fire for in-document scrolling when
    // `scrollEnabled` is false (which TenTap sets), so the WebView
    // installs a document-level scroll listener that posts a
    // {namespace:'ui', type:'document-scroll'} message; this callback
    // is invoked on every such message.
    //
    // The callback identity is read through a ref.
    onScroll?: () => void

    // Subscribe to messages with the 'comment' namespace from the
    // WebView. The text package's comment bridge uses this to route
    // tap / removed / selection-response / focus-response messages
    // into host-side resolvers and handler sets.
    //
    // Each call replaces any prior handler — the value is read through
    // a ref, so the consumer doesn't have to memoize it.
    onCommentMessage?: (message: EditorMessage) => void

    // Subscribe to messages with the 'find-replace' namespace from the
    // WebView. The text package's native find-replace controller uses
    // this to push the in-WebView plugin's state-update broadcasts
    // (matchCount / currentIndex / query) into a host-side Zustand
    // store that the FindReplaceBar mirrors.
    //
    // Each call replaces any prior handler — the value is read through
    // a ref, so the consumer doesn't have to memoize it.
    onFindReplaceMessage?: (message: EditorMessage) => void
}

// Shared TenTap-customSource wrapper. Encapsulates:
//   - useEditorBridge with the package's editorHtml + bridges
//   - useBridgeState subscription
//   - the EditorReady -> init-payload handshake
//   - adapting TenTap's command surface to the EditorResult contract
//
// Returns the same EditorResult shape consumers expect from any
// useDocumentEditor / useMailEditor variant.
export function useWebViewEditor(options: UseWebViewEditorOptions): EditorResult {
    const {
        editorHtml,
        bridgeExtensions,
        initPayload,
        editable,
        theme,
        avoidIosKeyboard = true,
        initialContent,
        scrollEnabled = true,
        onUiMessage,
        onScroll,
        onCommentMessage,
        onFindReplaceMessage,
    } = options

    // Pin onUiMessage behind a ref so the consumer can pass an
    // identity-fresh closure on each render without remounting the
    // WebView. The RichText component is recreated when EditorComponent
    // does its useMemo dance below; reading the latest callback off
    // the ref keeps the message bridge stable across re-renders.
    const onUiMessageRef = useRef(onUiMessage)
    onUiMessageRef.current = onUiMessage

    // Same indirection for onScroll. The 'ui' namespace fan-out below
    // recognizes 'document-scroll' and routes it to this ref. Keeping
    // it separate from onUiMessage means consumers don't have to write
    // a switch over message.type just to react to scroll, and the
    // event shape stays an implementation detail of the WebView.
    const onScrollRef = useRef(onScroll)
    onScrollRef.current = onScroll

    // Mirrors onUiMessageRef — the 'comment' namespace fan-out routes
    // every parsable comment message through this ref. The text
    // package's native comment bridge is the sole consumer today.
    const onCommentMessageRef = useRef(onCommentMessage)
    onCommentMessageRef.current = onCommentMessage

    // Same ref-backed pattern for the 'find-replace' namespace. The
    // text package's native FindReplaceController routes state-update
    // broadcasts from the in-WebView plugin into its Zustand mirror
    // through this hook.
    const onFindReplaceMessageRef = useRef(onFindReplaceMessage)
    onFindReplaceMessageRef.current = onFindReplaceMessage

    const liveBridge = useEditorBridge({
        initialContent,
        bridgeExtensions,
        theme,
        autofocus: false,
        avoidIosKeyboard,
        customSource: editorHtml,
    })

    // useEditorBridge returns a fresh wrapper object every render even
    // though its underlying refs are stable. Pinning the first wrapper
    // prevents the WebView from remounting on every parent re-render.
    // Mirrors mail's useMailEditor pattern.
    const bridgeRef = useRef<EditorBridge>(liveBridge)
    const bridge = bridgeRef.current

    const bridgeState = useBridgeState(bridge)

    // Plumb editable changes through to the WebView. setEditable is
    // safe to call before EditorReady; TenTap queues it.
    useEffect(() => {
        bridge.setEditable(editable)
    }, [bridge, editable])

    // The WebView's in-page React app posts {type:'editor-ready'} as
    // soon as the top-level <Editor /> mounts — BEFORE it constructs
    // its TipTap instance, because TipTap construction is gated on the
    // init payload from native. So this is the right signal to gate
    // the init post on. Note that we can't use bridgeState.isReady
    // (TenTap's StateUpdate-driven flag) for this: that one only flips
    // when the WebView sends a `stateUpdate`, which our custom Editor
    // only sends after init arrives — chicken-and-egg.
    const [webviewReady, setWebviewReady] = useState(false)

    // Post the package's init payload once the WebView signals ready.
    // Idempotent guard prevents double-init on hot-reload edge cases.
    // Intentionally one-shot per mount; if the in-WebView page reloads
    // itself (transient disconnect, in-WebView crash), it must re-fetch
    // state from its own bootstrap rather than rely on a re-init
    // payload from native.
    const initSentRef = useRef(false)
    useEffect(() => {
        if (initSentRef.current) return
        if (!webviewReady) return
        const webview = bridge.webviewRef?.current
        if (!webview) return
        const message = makeMessage('app', 'init', initPayload)
        try {
            webview.postMessage(JSON.stringify(message))
            initSentRef.current = true
        } catch {
            // postMessage can fail mid-handshake; the next render's
            // webviewReady or bridge identity change will retry.
        }
    }, [bridge, webviewReady, initPayload])

    const editor: EditorHandle = useMemo(
        () => ({
            getHTML: () => bridge.getHTML(),
            getText: () => bridge.getText(),
            setContent: (html: string) => bridge.setContent(html),
            focus: (position?: 'start' | 'end') => bridge.focus(position ?? 'end'),
            clear: () => bridge.setContent(''),
            // Native selection query is a request/response round-trip.
            // The in-WebView editor responds to {app,getSelection,reqId}
            // with {app,selectionResult,reqId}. Each call generates a
            // fresh requestId and waits on a one-shot resolver. v1
            // stub: return null until the Phase 4 work wires the
            // selection-query bridge. Phase 5 (awareness cursor) is the
            // first consumer.
            getSelection: () => Promise.resolve(null),
        }),
        [bridge]
    )

    const commands: EditorCommands = useMemo(() => buildWebViewEditorCommands(bridge), [bridge])

    // bridgeState carries every field posted in the WebView's
    // stateUpdate payload, but TenTap only types the fields registered
    // via bridge extensions. Our customSource Editor posts
    // isInTable/selectionEmpty/wordCount/etc. too — deriveToolbarState
    // reads them through a loose record view to avoid a declaration-
    // merging ceremony per consumer. The helper itself is pure so a
    // unit test can drive it against a synthetic bridgeState shape.
    const toolbarState = deriveToolbarState(bridgeState as unknown as Record<string, unknown>)

    // Wraps the WebView's onMessage so TenTap's bridge-extension dispatch
    // (state updates, core action responses) still runs while we layer
    // on 'ui' / 'comment' namespace observation. exclusivelyUseCustomOnMessage
    // is explicitly false so RichText's own handler keeps firing —
    // passing true would silence every TenTap bridge, including the
    // StateUpdate that powers useBridgeState. The handler ignores any
    // message that doesn't carry our explicit { namespace } envelope
    // (TenTap's own messages are typed { type, payload } without one).
    //
    // 'document-scroll' is a special-case 'ui' message that the WebView
    // posts from a window-level scroll listener; we fan it out to
    // onScroll(...) instead of forwarding to onUiMessage so consumers
    // can take it without writing a switch over message.type.
    const onWebViewMessage = useMemo(
        () => (event: WebViewMessageEvent) => {
            const data = event?.nativeEvent?.data
            if (typeof data !== 'string') return
            let parsed: EditorMessage
            try {
                parsed = JSON.parse(data) as EditorMessage
            } catch {
                return
            }
            // The WebView's bootstrap posts {type:'editor-ready'} as
            // its first message, before TipTap mounts. That's the
            // signal we use to gate the init post — see webviewReady
            // above. TenTap's onMessage also sees this (we run
            // alongside its dispatch), but it doesn't flip any
            // bridgeState flag from it.
            if (parsed.type === 'editor-ready') {
                setWebviewReady(true)
                return
            }
            if (parsed.namespace === 'ui') {
                if (parsed.type === 'document-scroll') {
                    onScrollRef.current?.()
                    return
                }
                onUiMessageRef.current?.(parsed)
                return
            }
            if (parsed.namespace === 'comment') {
                onCommentMessageRef.current?.(parsed)
                return
            }
            if (parsed.namespace === 'find-replace') {
                onFindReplaceMessageRef.current?.(parsed)
                return
            }
            // other namespaces ignored
        },
        []
    )

    // RichText is loaded lazily inside the EditorComponent because this
    // hook is a single non-platform file (not a .native.tsx split). A
    // top-level import of RichText would force web bundles to resolve
    // react-native-webview, which has no web shim. The lazy require runs
    // only when EditorComponent renders, which only happens on native.
    const EditorComponent = useMemo(
        () =>
            function WebViewEditorContent() {
                const { RichText } = require('@10play/tentap-editor')
                return (
                    <View className="flex-1">
                        <RichText
                            editor={bridge}
                            scrollEnabled={scrollEnabled}
                            onMessage={onWebViewMessage}
                            exclusivelyUseCustomOnMessage={false}
                        />
                    </View>
                )
            },
        [bridge, scrollEnabled, onWebViewMessage]
    )

    // Surface the WebView ref through the EditorResult so host code can
    // call .measure(...) to translate the WebView's viewport coords
    // into screen coords (for anchored popovers) and .postMessage(...)
    // to send 'ui' namespace responses back. The ref's `current` is
    // the underlying react-native-webview instance — opaque to us, the
    // anchored-overlay controller narrows it at the call site.
    const webViewRef = bridge.webviewRef as React.RefObject<unknown>

    // Generic message poster. Native consumers (e.g. the text package's
    // comment bridge) use this to drive WebView-side handlers that
    // don't have a first-class command surface on `commands`. Returns
    // false when the WebView isn't mounted yet so callers can choose
    // to swallow or surface the failure. Web variants of consuming
    // hooks return `() => false` instead because there's no WebView.
    const postMessage = useCallback(
        (message: EditorMessage): boolean => {
            const webview = bridge.webviewRef?.current as
                | { postMessage?: (s: string) => void }
                | null
                | undefined
            if (!webview || typeof webview.postMessage !== 'function') return false
            webview.postMessage(JSON.stringify(message))
            return true
        },
        [bridge]
    )

    return {
        editor,
        EditorComponent,
        commands,
        toolbarState,
        webViewRef,
        postMessage,
        isReady: bridgeState.isReady === true,
    }
}
