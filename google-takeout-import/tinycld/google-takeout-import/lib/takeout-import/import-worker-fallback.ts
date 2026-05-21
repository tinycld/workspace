import { unzip } from 'fflate'
import { parseCalendars } from './parsers/calendar'
import { parseContacts } from './parsers/contacts'
import { driveRecordsInOrder, parseDriveEntries } from './parsers/drive'
import { countMboxMessages, parseMbox } from './parsers/mail'
import type { ImportService, ParsedRecord, TakeoutDetection } from './types'

const BATCH_SIZE = 50

function yieldToUI(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
}

async function extractAllZips(files: File[]): Promise<Map<string, Uint8Array>> {
    const entries = new Map<string, Uint8Array>()

    for (const file of files) {
        const buffer = await file.arrayBuffer()
        const uint8 = new Uint8Array(buffer)

        const unzipped = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
            unzip(uint8, (err, result) => {
                if (err) reject(err)
                else resolve(result)
            })
        })

        for (const [path, data] of Object.entries(unzipped)) {
            entries.set(path, data)
        }
    }

    return entries
}

function detectServices(entries: Map<string, Uint8Array>): TakeoutDetection {
    let hasContacts = false
    let hasCalendar = false
    let hasDrive = false
    let hasMail = false
    let fileCount = 0
    let totalSize = 0

    for (const [path, data] of entries) {
        fileCount++
        totalSize += data.byteLength

        if (path.includes('Contacts/') && path.endsWith('.vcf')) hasContacts = true
        if (path.includes('Calendar/') && path.endsWith('.ics')) hasCalendar = true
        if (path.startsWith('Takeout/Drive/')) hasDrive = true
        if (path.includes('Mail/') && path.endsWith('.mbox')) hasMail = true
    }

    const contactCount = hasContacts ? parseContacts(entries).length : 0
    const eventCount = hasCalendar ? parseCalendars(entries).reduce((sum, c) => sum + c.events.length, 0) : 0
    const driveFileCount = hasDrive ? parseDriveEntries(entries).files.length : 0
    const mailThreadCount = hasMail ? countMboxMessages(entries) : 0

    return {
        hasContacts: contactCount > 0,
        hasCalendar: eventCount > 0,
        hasDrive: driveFileCount > 0,
        hasMail: mailThreadCount > 0,
        contactCount,
        eventCount,
        driveFileCount,
        mailThreadCount,
        fileCount,
        totalSize,
    }
}

export interface FallbackCallbacks {
    onDetection: (detection: TakeoutDetection) => void
    onBatch: (service: ImportService, records: ParsedRecord[]) => Promise<void>
    onProgress: (service: ImportService, phase: 'scanning' | 'importing' | 'done', total: number) => void
    onDone: () => void
    onError: (message: string) => void
}

export async function runFallbackImport(files: File[], services: ImportService[], callbacks: FallbackCallbacks) {
    try {
        const entries = await extractAllZips(files)
        const detection = detectServices(entries)
        callbacks.onDetection(detection)

        await yieldToUI()

        if (services.includes('contacts')) {
            callbacks.onProgress('contacts', 'scanning', 0)
            await yieldToUI()
            const contacts = parseContacts(entries)
            callbacks.onProgress('contacts', 'importing', contacts.length)
            await processBatches('contacts', contacts, callbacks)
        }

        if (services.includes('calendar')) {
            callbacks.onProgress('calendar', 'scanning', 0)
            await yieldToUI()
            const calendars = parseCalendars(entries)
            const allRecords: ParsedRecord[] = []
            for (const cal of calendars) {
                allRecords.push(cal)
                allRecords.push(...cal.events)
            }
            callbacks.onProgress('calendar', 'importing', allRecords.length)
            await processBatches('calendar', allRecords, callbacks)
        }

        if (services.includes('drive')) {
            callbacks.onProgress('drive', 'scanning', 0)
            await yieldToUI()
            const { folders, files: driveFiles } = parseDriveEntries(entries)
            const records = driveRecordsInOrder(folders, driveFiles)
            callbacks.onProgress('drive', 'importing', records.length)
            await processBatches('drive', records, callbacks)
        }

        if (services.includes('mail')) {
            callbacks.onProgress('mail', 'scanning', 0)
            await yieldToUI()
            const threads = parseMbox(entries)
            callbacks.onProgress('mail', 'importing', threads.length)
            await processBatches('mail', threads, callbacks)
        }

        callbacks.onDone()
    } catch (err) {
        callbacks.onError(err instanceof Error ? err.message : 'Import failed')
    }
}

async function processBatches(service: ImportService, records: ParsedRecord[], callbacks: FallbackCallbacks) {
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE)
        await callbacks.onBatch(service, batch)
        callbacks.onProgress(service, 'importing', records.length)
        await yieldToUI()
    }
    callbacks.onProgress(service, 'done', records.length)
}

export async function detectOnly(files: File[]): Promise<TakeoutDetection> {
    const entries = await extractAllZips(files)
    return detectServices(entries)
}
