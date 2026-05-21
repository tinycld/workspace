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

export interface ImportContext {
    orgId: string
    userOrgId: string
    mailboxId: string | null
}

// Parsed record types
export type ParsedRecord =
    | ParsedContact
    | ParsedCalendarEvent
    | ParsedCalendar
    | ParsedDriveFolder
    | ParsedDriveFile
    | ParsedMailThread

export interface ParsedContact {
    recordType: 'contact'
    first_name: string
    last_name: string
    email: string
    phone: string
    company: string
    job_title: string
    notes: string
    vcard_uid: string
}

export interface ParsedCalendar {
    recordType: 'calendar'
    name: string
    events: ParsedCalendarEvent[]
}

export interface ParsedCalendarEvent {
    recordType: 'calendar_event'
    calendarName: string
    title: string
    description: string
    location: string
    start: string
    end: string
    all_day: boolean
    recurrence: string
    ical_uid: string
    guests: EventGuest[]
    reminder: number
    busy_status: 'busy' | 'free'
    visibility: 'default' | 'public' | 'private'
}

export interface EventGuest {
    name: string
    email: string
    rsvp: string
}

export interface ParsedDriveFolder {
    recordType: 'drive_folder'
    path: string
    name: string
}

export interface ParsedDriveFile {
    recordType: 'drive_file'
    path: string
    name: string
    parentPath: string
    mime_type: string
    size: number
    bytes: ArrayBuffer
}

export interface ParsedMailThread {
    recordType: 'mail_thread'
    gmailThreadId: string
    subject: string
    snippet: string
    messages: ParsedMailMessage[]
    folder: 'inbox' | 'sent' | 'drafts' | 'trash' | 'spam' | 'archive'
    is_read: boolean
    is_starred: boolean
    labels: string[]
}

export interface ParsedMailMessage {
    message_id: string
    in_reply_to: string
    sender_name: string
    sender_email: string
    recipients_to: { name: string; email: string }[]
    recipients_cc: { name: string; email: string }[]
    date: string
    subject: string
    snippet: string
    body_html: string
    has_attachments: boolean
    attachments: ParsedAttachment[]
}

export interface ParsedAttachment {
    filename: string
    mime_type: string
    bytes: ArrayBuffer
}
