/**
 * Playwright Global Setup
 *
 * Truncates tmp/emails.log so each test run sees a clean mail log.
 *
 * The DB reset+seed is NOT done here — it's part of the webServer command
 * (`npm run expo:test` chains `reset-dev-db.ts` before `dev.ts`). Doing it
 * in globalSetup raced with webServer startup: Playwright spawns webServer
 * in parallel with globalSetup, so dev.ts's PB would open server/pb_test_data
 * while reset-dev-db.ts was still deleting and reseeding it — yielding a
 * PB that returned auth records pointing at IDs that no longer existed
 * in the on-disk DB. Chaining inside expo:test serializes the two steps.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..')
export const TMP_DIR = path.join(PROJECT_ROOT, 'tmp')
export const EMAIL_LOG_PATH = path.join(TMP_DIR, 'emails.log')

export default async function globalSetup() {
    fs.mkdirSync(TMP_DIR, { recursive: true })
    fs.writeFileSync(EMAIL_LOG_PATH, '')
}
