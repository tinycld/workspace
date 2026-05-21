// Re-export entry. Metro resolves `.web.ts` on web and `.native.ts` on
// iOS/Android, so `import { downloadCsv } from './download'` lands on
// the right platform automatically. This file is the typecheck target
// and the fallback resolution.
export { downloadCsv } from './download.web'
