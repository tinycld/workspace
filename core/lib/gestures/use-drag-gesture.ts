// Re-export entry. Metro resolves `.web.ts` on web and `.native.ts` on
// iOS/Android, so `import { useDragGesture } from './use-drag-gesture'`
// lands on the right platform automatically. This file is the typecheck
// target and the fallback resolution.
export { useDragGesture } from './use-drag-gesture.web'
