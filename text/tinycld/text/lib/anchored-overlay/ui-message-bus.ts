import type { EditorMessage } from '@tinycld/core/lib/editor/message-bus/types'

// A tiny pub/sub for 'ui' namespace messages flowing from the WebView
// into the host. The native useDocumentEditor variant publishes every
// message it receives from useWebViewEditor's onUiMessage callback into
// this bus; consumers (anchored-overlay controller, future comment
// popovers, …) subscribe to react.
//
// We deliberately do not use Zustand here: the bus has no state
// (it's purely event-routing), and a Zustand store would force every
// subscriber to also use a React render path. The plain set+function
// pattern works equally well outside React (e.g. for unit tests),
// keeps the call stack shallow, and avoids hidden re-render fanouts
// that a getState() consumer would have to write around.

// Internal payload type that the bus accepts. We don't constrain the
// payload shape — consumers narrow by message.namespace/type at the
// call site (the registered handlers usually only care about
// {namespace:'ui', type:'show-popover'} etc.).
type Handler = (message: EditorMessage) => void

const handlers = new Set<Handler>()

// Add a handler. The returned function removes it. Idempotent against
// double-subscribe (Set semantics) and double-unsubscribe (delete on
// a missing entry is a no-op).
export function subscribeUiMessage(handler: Handler): () => void {
    handlers.add(handler)
    return () => {
        handlers.delete(handler)
    }
}

// Fan out a message to every current subscriber. If a handler throws,
// we let the other subscribers still receive the event — the bus is
// an event router, not a chain. The thrown error is re-raised at the
// end so a test or upstream error boundary can still see it.
export function publishUiMessage(message: EditorMessage): void {
    let thrown: unknown = null
    for (const handler of handlers) {
        try {
            handler(message)
        } catch (err) {
            thrown = err
        }
    }
    if (thrown !== null) throw thrown
}

// Test-only helper. Drops every subscriber from the bus. The bus is
// process-global so tests that publish into it can leak handlers
// across test files; `resetUiMessageBus()` in a beforeEach() keeps
// suites independent without each test having to track its own
// unsubscribe handles.
export function resetUiMessageBus(): void {
    handlers.clear()
}
