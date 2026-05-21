// Base module for TypeScript resolution. Metro picks run-import.web.ts on web
// and run-import.native.ts on iOS/Android at bundle time.
import type { ImportContext, ImportService, TakeoutDetection } from './types'

export function detect(_files: File[], _context: ImportContext): Promise<TakeoutDetection> {
    throw new Error('run-import base module should never run')
}

export function runImport(_files: File[], _services: ImportService[], _context: ImportContext): Promise<void> {
    throw new Error('run-import base module should never run')
}

export function requestCancel(): void {
    throw new Error('run-import base module should never run')
}
