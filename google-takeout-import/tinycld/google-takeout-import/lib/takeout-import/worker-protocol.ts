import type { AuthRecord } from 'pocketbase'
import type { ImportContext, ImportProgress, ImportService, TakeoutDetection } from './types'

export type MainToWorker =
    | {
          type: 'init'
          authToken: string
          authRecord: AuthRecord
          serverAddr: string
          context: ImportContext
      }
    | { type: 'detect'; files: File[] }
    | { type: 'start-import'; services: ImportService[]; files: File[] }
    | { type: 'cancel' }

export type WorkerToMain =
    | { type: 'ready' }
    | { type: 'detection'; detection: TakeoutDetection }
    | {
          type: 'service-phase'
          service: ImportService
          phase: 'scanning' | 'importing' | 'done'
          total: number
      }
    | { type: 'progress'; service: ImportService; update: Partial<ImportProgress> }
    | { type: 'complete' }
    | { type: 'cancelled' }
    | { type: 'error'; message: string }
