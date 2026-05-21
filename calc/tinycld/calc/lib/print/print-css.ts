// Re-export entry. Metro resolves `.web.ts` on web and `.native.ts`
// on iOS/Android, so `import { buildPrintCss } from './print-css'`
// lands on the right platform automatically. This is the
// typecheck-time fallback (Metro never picks this file at runtime
// when a per-platform variant exists).
export { buildPrintCss } from './print-css.web'
