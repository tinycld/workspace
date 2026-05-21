// Re-export entry. Metro resolves `.web.ts` on web and `.native.ts` on
// iOS/Android, so `import { handlePrint } from './handle-print'` lands
// on the right platform automatically. This file is the typecheck
// target and the fallback resolution.
export { handlePrint } from './handle-print.web'
