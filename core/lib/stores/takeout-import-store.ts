import { create } from '@tinycld/core/lib/store'

// Structural duplicates of the takeout package's types. Kept in sync by
// convention (see docs/superpowers/specs/2026-04-18-decouple-core-from-packages-design.md).
// The core store must compile without the takeout package linked — that's the
// whole point of the decoupling work — so we duplicate these shapes rather
// than importing from @tinycld/google-takeout-import.
export type ImportService = 'contacts' | 'calendar' | 'drive' | 'mail'
export type ImportPhase = 'scanning' | 'importing' | 'done'
export interface ImportProgress {
    service: ImportService
    phase: ImportPhase
    total: number
    imported: number
    skipped: number
    errors: number
    errorMessages: string[]
}
export interface TakeoutDetection {
    hasContacts: boolean
    hasCalendar: boolean
    hasDrive: boolean
    hasMail: boolean
    contactCount: number
    eventCount: number
    driveFileCount: number
    mailThreadCount: number
    fileCount: number
    totalSize: number
}

type OverallPhase = 'idle' | 'detecting' | 'importing' | 'complete' | 'error'

interface TakeoutImportState {
    files: File[]
    detection: TakeoutDetection | null
    selectedServices: Record<ImportService, boolean>
    progress: Record<ImportService, ImportProgress>
    phase: OverallPhase
    overallError: string | null
    activeServices: ImportService[]
    cancelRequested: boolean
    fallbackActive: boolean

    setFiles: (files: File[]) => void
    setDetection: (detection: TakeoutDetection) => void
    toggleService: (service: ImportService) => void
    updateProgress: (service: ImportService, update: Partial<ImportProgress>) => void
    setPhase: (phase: OverallPhase) => void
    setOverallError: (error: string | null) => void
    setActiveServices: (services: ImportService[]) => void
    requestCancel: () => void
    setFallbackActive: (active: boolean) => void
    reset: () => void
}

function emptyProgress(): Record<ImportService, ImportProgress> {
    const empty = (service: ImportService): ImportProgress => ({
        service,
        phase: 'scanning',
        total: 0,
        imported: 0,
        skipped: 0,
        errors: 0,
        errorMessages: [],
    })
    return {
        contacts: empty('contacts'),
        calendar: empty('calendar'),
        drive: empty('drive'),
        mail: empty('mail'),
    }
}

const NO_SELECTION: Record<ImportService, boolean> = {
    contacts: false,
    calendar: false,
    drive: false,
    mail: false,
}

export const useTakeoutImportStore = create<TakeoutImportState>()(set => ({
    files: [],
    detection: null,
    selectedServices: { ...NO_SELECTION },
    progress: emptyProgress(),
    phase: 'idle',
    overallError: null,
    activeServices: [],
    cancelRequested: false,
    fallbackActive: false,

    setFiles: files => set({ files }),
    setDetection: detection =>
        set({
            detection,
            selectedServices: {
                contacts: detection.hasContacts,
                calendar: detection.hasCalendar,
                drive: detection.hasDrive,
                mail: detection.hasMail,
            },
        }),
    toggleService: service =>
        set(state => ({
            selectedServices: {
                ...state.selectedServices,
                [service]: !state.selectedServices[service],
            },
        })),
    updateProgress: (service, update) =>
        set(state => {
            const prev = state.progress[service]
            return {
                progress: {
                    ...state.progress,
                    [service]: {
                        ...prev,
                        phase: update.phase ?? prev.phase,
                        total: update.total ?? prev.total,
                        imported: prev.imported + (update.imported ?? 0),
                        skipped: prev.skipped + (update.skipped ?? 0),
                        errors: prev.errors + (update.errors ?? 0),
                        errorMessages: update.errorMessages
                            ? [...prev.errorMessages, ...update.errorMessages]
                            : prev.errorMessages,
                    },
                },
            }
        }),
    setPhase: phase => set({ phase }),
    setOverallError: overallError => set({ overallError }),
    setActiveServices: activeServices => set({ activeServices }),
    requestCancel: () => set({ cancelRequested: true }),
    setFallbackActive: active => set({ fallbackActive: active }),
    reset: () =>
        set({
            files: [],
            detection: null,
            selectedServices: { ...NO_SELECTION },
            progress: emptyProgress(),
            phase: 'idle',
            overallError: null,
            activeServices: [],
            cancelRequested: false,
            fallbackActive: false,
        }),
}))
