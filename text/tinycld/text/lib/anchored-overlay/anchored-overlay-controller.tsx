import { makeMessage } from '@tinycld/core/lib/editor/message-bus/types'
import { useEffect, useReducer, useState } from 'react'
import { Dimensions, Modal, Platform, Pressable, View } from 'react-native'
import {
    type AnchoredOverlayAction,
    type AnchoredOverlayRequest,
    type AnchoredOverlayResponseAction,
    anchoredOverlayReducer,
    decodeUiMessage,
    initialAnchoredOverlayState,
    resolvePopoverPosition,
} from './anchored-overlay-state'
import { subscribeUiMessage } from './ui-message-bus'

// Vertical gap between the anchor's bottom and the popover. Mirrors the
// web's POPOVER_GAP_PX so the two platforms feel visually consistent.
const POPOVER_GAP_PX = 4
// Estimated popover height for the flip-above-the-caret decision. The
// web variant uses the same value; we don't try to do a measure-then-
// reflow pass on native because the flicker would be more disruptive
// than a slightly-imprecise flip threshold.
const POPOVER_HEIGHT_ESTIMATE_PX = 320
const POPOVER_WIDTH_PX = 260

// Minimal duck-typed shape we use off the WebView ref. The TenTap
// webviewRef points at the underlying react-native-webview instance,
// which exposes both .measure (a RN View method) and .postMessage
// (an RN-WebView method). We don't depend on the full type — every
// callsite narrows on `typeof ... === 'function'` before invoking.
interface WebViewMeasurable {
    measure(
        cb: (
            x: number,
            y: number,
            width: number,
            height: number,
            pageX: number,
            pageY: number
        ) => void
    ): void
    postMessage(message: string): void
}

// Subset of a WebView ref that the controller needs.
type WebViewRef = React.RefObject<unknown> | null

// Props accepted by every overlay component the registry knows about.
// payload comes verbatim from the WebView's show-popover.payload (kind-
// scoped); respond closes the popover by posting popover-result back.
//
// The controller hands the body a `respond` closure rather than
// surfacing the protocol; each body just calls respond('select', ...)
// or respond('dismiss') on user input. Future overlay kinds plug in
// the same way.
export interface AnchoredOverlayProps {
    payload: unknown
    respond: (action: AnchoredOverlayResponseAction, payload?: unknown) => void
}

export interface AnchoredOverlayRegistry {
    [kind: string]: (props: AnchoredOverlayProps) => React.ReactNode
}

interface AnchoredOverlayControllerProps {
    webViewRef: WebViewRef
    registry: AnchoredOverlayRegistry
}

// Promise wrapper around .measure(). Resolves to null when the ref is
// missing, the current value isn't a measurable, or measure returns
// without invoking the callback (the RN runtime can drop measure calls
// when a view isn't laid out yet). On null the controller fails closed —
// dismisses the request and posts popover-result so the WebView clears
// its trigger — rather than rendering the popover at (0, 0) with no
// relationship to the caret.
async function measureWebView(
    ref: WebViewRef
): Promise<{ pageX: number; pageY: number; width: number; height: number } | null> {
    const r = ref?.current as Partial<WebViewMeasurable> | null | undefined
    if (!r || typeof r.measure !== 'function') return null
    return new Promise(resolve => {
        let resolved = false
        const fallback = setTimeout(() => {
            if (!resolved) {
                resolved = true
                resolve(null)
            }
        }, 250)
        try {
            ;(r as WebViewMeasurable).measure((_x, _y, width, height, pageX, pageY) => {
                if (resolved) return
                resolved = true
                clearTimeout(fallback)
                resolve({ pageX, pageY, width, height })
            })
        } catch {
            clearTimeout(fallback)
            resolved = true
            resolve(null)
        }
    })
}

// Send a 'ui' namespace message into the WebView. Used to deliver
// popover-result responses (and any future host→WebView UI message).
// Safe to call when the ref is detached — the message is silently
// dropped because the WebView is gone, which matches the "fire and
// forget" semantics of the bus.
function postUiToWebView(ref: WebViewRef, type: string, payload: unknown, requestId?: string) {
    const r = ref?.current as Partial<WebViewMeasurable> | null | undefined
    if (!r || typeof r.postMessage !== 'function') return
    try {
        ;(r as WebViewMeasurable).postMessage(JSON.stringify(makeMessage('ui', type, payload, requestId)))
    } catch {
        // postMessage throws if the WebView's content world hasn't
        // initialized yet (very early in the mount, before the bridge
        // is up). Swallow — the popover protocol is best-effort.
    }
}

// AnchoredOverlayController — host-side overlay router. Subscribes to
// the ui-message-bus, opens an absolutely-positioned Modal with the
// kind-specific body, and responds back to the WebView. Web mounts of
// this component are no-ops (we render through a portal there, not a
// Modal), which keeps screen-level mounting platform-agnostic.
export function AnchoredOverlayController({
    webViewRef,
    registry,
}: AnchoredOverlayControllerProps): React.ReactElement | null {
    const [state, dispatch] = useReducer(anchoredOverlayReducer, initialAnchoredOverlayState)
    const [screenPos, setScreenPos] = useState<{ top: number; left: number } | null>(null)

    // Subscribe to the bus so 'show-popover' / 'popover-update' /
    // 'popover-dismiss-on-scroll' / 'popover-exited' messages get
    // reduced into state. The native variant of useDocumentEditor is
    // responsible for publishing every 'ui' message into the bus; we
    // just consume.
    useEffect(() => {
        const unsubscribe = subscribeUiMessage(message => {
            const action: AnchoredOverlayAction | null = decodeUiMessage(message)
            if (action) dispatch(action)
        })
        return unsubscribe
    }, [])

    // On show, .measure() the WebView to translate viewport coords to
    // screen coords, then compute the popover anchor. We re-run only on
    // a fresh request (requestId change) so popover-update messages
    // don't trigger a remeasure — the anchor is fixed once the popover
    // opens, and an in-flight scroll already dismisses.
    //
    // webViewRef is intentionally omitted from the dep array: the
    // useEditorBridge hook returns a stable RefObject whose identity
    // doesn't change across renders. Including it would invite a
    // re-measure on a hypothetical ref swap that the surrounding code
    // doesn't actually perform.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
    useEffect(() => {
        if (!state.open) {
            setScreenPos(null)
            return
        }
        let cancelled = false
        const open = state.open
        ;(async () => {
            const m = await measureWebView(webViewRef)
            if (cancelled) return
            if (!m) {
                // Measure failed (no ref, timed out, threw). Falling
                // back to (0, 0) would render the popover in the
                // top-left of the screen with no visual relationship
                // to the caret — worse than showing nothing. Fail
                // closed: dismiss the request and tell the WebView we
                // gave up so the suggestion plugin clears its trigger.
                postUiToWebView(
                    webViewRef,
                    'popover-result',
                    { action: 'dismiss' as AnchoredOverlayResponseAction },
                    open.requestId
                )
                dispatch({ type: 'dismiss-external' })
                return
            }
            const { width: vw, height: vh } = Dimensions.get('window')
            setScreenPos(
                resolvePopoverPosition({
                    rect: open.rect,
                    webViewOriginX: m.pageX,
                    webViewOriginY: m.pageY,
                    viewportWidth: vw,
                    viewportHeight: vh,
                    popoverWidth: POPOVER_WIDTH_PX,
                    popoverHeightEstimate: POPOVER_HEIGHT_ESTIMATE_PX,
                    gap: POPOVER_GAP_PX,
                })
            )
        })()
        return () => {
            cancelled = true
        }
    }, [state.open?.requestId])

    if (Platform.OS === 'web') return null
    if (!state.open || !screenPos) return null

    const open: AnchoredOverlayRequest = state.open
    const Body = registry[open.kind]
    if (!Body) return null

    const respond = (action: AnchoredOverlayResponseAction, payload?: unknown) => {
        postUiToWebView(
            webViewRef,
            'popover-result',
            { action, payload: payload ?? undefined },
            open.requestId
        )
        dispatch({ type: 'respond', requestId: open.requestId })
    }

    const dismissExternal = () => {
        postUiToWebView(
            webViewRef,
            'popover-result',
            { action: 'dismiss' as AnchoredOverlayResponseAction },
            open.requestId
        )
        dispatch({ type: 'dismiss-external' })
    }

    // Modal is transparent so the absolutely-positioned popover floats
    // over the WebView at the computed screen coords. The full-screen
    // Pressable behind it captures backdrop taps for dismiss without
    // intercepting touches on the popover itself.
    return (
        <Modal
            transparent
            visible
            animationType="none"
            onRequestClose={dismissExternal}
            // statusBarTranslucent matches our app's other Modals so the
            // popover anchor math (which uses Dimensions.get('window'))
            // matches the actual layer the popover renders into.
            statusBarTranslucent
        >
            <Pressable
                onPress={dismissExternal}
                accessibilityRole="button"
                accessibilityLabel="Dismiss popover"
                style={{ flex: 1 }}
            >
                <View
                    style={{
                        position: 'absolute',
                        top: screenPos.top,
                        left: screenPos.left,
                        width: POPOVER_WIDTH_PX,
                        maxHeight: POPOVER_HEIGHT_ESTIMATE_PX,
                    }}
                    // onStartShouldSetResponder=true stops backdrop taps
                    // that originate inside the popover from bubbling up
                    // to the backdrop Pressable.
                    onStartShouldSetResponder={() => true}
                >
                    <Body payload={open.payload} respond={respond} />
                </View>
            </Pressable>
        </Modal>
    )
}
