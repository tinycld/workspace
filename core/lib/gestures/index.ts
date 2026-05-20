// Metro picks the right file via the .native.ts / .web.ts extensions;
// this barrel just re-exports so consumers write a single import.

export type {
    DragContext,
    DragGestureHandlers,
    PointerLike,
    UseDragGestureOptions,
} from './types'
export { useDragGesture } from './use-drag-gesture'
