// Cross-platform drag gesture primitive. Web uses native PointerEvents
// with setPointerCapture; native uses PanResponder. The hook abstracts
// both behind a single callback shape so consumers write one body.

export interface PointerLike {
    // Viewport-relative coordinates (web: clientX/Y; native: pageX/Y).
    // Consumers convert to local frame using their own geometry.
    x: number
    y: number
    // Modifier keys at down-time. Always false on native — keep the
    // fields present so consumer code stays branchless.
    shiftKey: boolean
    ctrlKey: boolean
    metaKey: boolean
    altKey: boolean
}

export interface DragContext {
    // Reported at start, every move, and end.
    pointer: PointerLike
    // Movement since drag-start. Useful for column resize (deltaX) and
    // for hit-testing during selection drag (consumer adds delta to a
    // captured starting cell).
    deltaX: number
    deltaY: number
    // The bounding rect of the originating element at drag-start. Web
    // gets this from currentTarget.getBoundingClientRect(); native
    // gets it from a measureInWindow on the responder's ref. Optional
    // because the consumer can pass `measureTarget: false` to skip it
    // when not needed (saves a measure roundtrip on native).
    startRect: { left: number; top: number; width: number; height: number } | null
}

export interface UseDragGestureOptions {
    // Fires once when the user has moved past the engagement threshold.
    // Return false to refuse the gesture (e.g. the cursor isn't in a
    // ref-acceptable position for formula drag). The hook still tracks
    // the pointer to clean up on release, but onDragMove / onDragEnd
    // are not called.
    onDragStart?: (ctx: DragContext) => boolean | undefined
    onDragMove?: (ctx: DragContext) => void
    onDragEnd?: (ctx: DragContext) => void
    // Movement threshold in px before onDragStart fires. Defaults to 3
    // (matches the existing calc drag-select threshold).
    threshold?: number
    // If true, the hook measures the originating element on drag-start
    // and reports its rect via DragContext.startRect. Defaults to true.
    measureTarget?: boolean
    // Disable the gesture entirely. The hook still returns props so
    // the consumer's JSX stays static, but the handlers are no-ops.
    disabled?: boolean
}

export interface DragGestureHandlers {
    // Spread these onto the originating element (Pressable / View).
    // Web returns DOM-style pointer-event props; native returns
    // PanResponder.panHandlers. The consumer doesn't need to know
    // which — both shapes are erased through `Record<string, unknown>`.
    handlers: Record<string, unknown>
    // True when a drag is in flight (between threshold-crossing and
    // release). Useful for showing a drag-state highlight, or for
    // suppressing the synthetic click after release.
    isDragging: boolean
    // True if the most recent gesture ended after engaging (i.e.
    // onDragStart returned true and onDragEnd fired). Resets to false
    // on the next pointer-down. Consumers check this in their onPress
    // handler to suppress the synthetic click on web.
    wasDragged: boolean
}
