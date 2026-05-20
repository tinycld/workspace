import { z } from 'zod'

const DATETIME_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?Z$/

export const auditLogsSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    org: z.string().regex(/^[a-z0-9]+$/).length(15),
    actor: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    action: z.enum(["created", "updated", "deleted"]),
    resource_type: z.string().min(1).max(100),
    resource_id: z.string().min(1).max(50),
    resource_label: z.string().max(500).optional(),
    changes: z.unknown().optional(),
    snapshot: z.unknown().optional(),
    ip_address: z.string().max(100).optional(),
    user_agent: z.string().max(500).optional(),
    metadata: z.unknown().optional(),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
})

export const calcCommentsSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    drive_item: z.string().regex(/^[a-z0-9]+$/).length(15),
    sheet_id: z.string().min(1).max(64),
    row: z.number().min(1).refine((n) => n !== 0),
    col: z.number().min(1).refine((n) => n !== 0),
    body: z.string().min(1).max(4000),
    resolved_at: z.string().regex(DATETIME_REGEX).optional(),
    author: z.string().regex(/^[a-z0-9]+$/).length(15),
    author_name: z.string().min(1).max(200),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
    parent_comment: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
})

export const calendarCalendarsSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    org: z.string().regex(/^[a-z0-9]+$/).length(15),
    name: z.string().min(1).max(200),
    description: z.string().max(500).optional(),
    color: z.enum(["blue", "green", "red", "teal", "purple", "orange", "tomato", "flamingo", "tangerine", "banana", "sage", "basil", "peacock", "blueberry", "lavender", "grape", "graphite"]),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
    subscription_url: z.string().url().optional(),
    subscription_last_sync: z.string().regex(DATETIME_REGEX).optional(),
    subscription_error: z.string().optional(),
})

export const calendarEventsSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    calendar: z.string().regex(/^[a-z0-9]+$/).length(15),
    created_by: z.string().regex(/^[a-z0-9]+$/).length(15),
    title: z.string().min(1).max(500),
    description: z.string().max(5000).optional(),
    location: z.string().max(500).optional(),
    start: z.string().regex(DATETIME_REGEX),
    end: z.string().regex(DATETIME_REGEX),
    all_day: z.boolean().optional(),
    recurrence: z.string().max(500).optional(),
    guests: z.unknown().optional(),
    reminder: z.number().optional(),
    busy_status: z.enum(["busy", "free"]),
    visibility: z.enum(["default", "public", "private"]),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
    ical_uid: z.string().max(500).optional(),
    recurrence_until: z.string().regex(DATETIME_REGEX).optional(),
})

export const calendarMembersSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    calendar: z.string().regex(/^[a-z0-9]+$/).length(15),
    user_org: z.string().regex(/^[a-z0-9]+$/).length(15),
    role: z.enum(["owner", "editor", "viewer"]),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
    color: z.enum(["blue", "green", "red", "teal", "purple", "orange", "tomato", "flamingo", "tangerine", "banana", "sage", "basil", "peacock", "blueberry", "lavender", "grape", "graphite"]).optional(),
})

export const commentMentionsSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    comment_collection: z.string().min(1).max(64),
    comment_record: z.string().min(1).max(32),
    drive_item: z.string().regex(/^[a-z0-9]+$/).length(15),
    mentioned_user_org: z.string().regex(/^[a-z0-9]+$/).length(15),
    created: z.string().regex(DATETIME_REGEX).optional(),
})

export const contactsSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    email: z.string().email().optional(),
    phone: z.string().max(50).optional(),
    owner: z.string().regex(/^[a-z0-9]+$/).length(15),
    notes: z.string().optional(),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
    first_name: z.string().min(1).max(100),
    last_name: z.string().max(100).optional(),
    company: z.string().max(200).optional(),
    job_title: z.string().max(200).optional(),
    favorite: z.boolean().optional(),
    vcard_uid: z.string().max(255).optional(),
    deleted_at: z.string().regex(DATETIME_REGEX).optional(),
})

export const demoLeadsSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    email: z.string().email(),
    reason: z.string().max(2000).optional(),
    source: z.enum(["intro_modal", "banner_link"]),
    user_agent: z.string().max(1000).optional(),
    ip: z.string().max(100).optional(),
    created: z.string().regex(DATETIME_REGEX).optional(),
})

export const driveItemStateSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    item: z.string().regex(/^[a-z0-9]+$/).length(15),
    user_org: z.string().regex(/^[a-z0-9]+$/).length(15),
    is_starred: z.boolean().optional(),
    trashed_at: z.string().regex(DATETIME_REGEX).optional(),
    last_viewed_at: z.string().regex(DATETIME_REGEX).optional(),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
})

export const driveItemVersionsSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    item: z.string().regex(/^[a-z0-9]+$/).length(15),
    version_number: z.number().min(1).refine((n) => n !== 0),
    file: z.string().optional(),
    size: z.number().optional(),
    mime_type: z.string().max(255).optional(),
    source: z.enum(["upload", "system"]),
    label: z.string().max(500).optional(),
    created_by: z.string().regex(/^[a-z0-9]+$/).length(15),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
})

export const driveItemsSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    org: z.string().regex(/^[a-z0-9]+$/).length(15),
    name: z.string().min(1).max(500),
    is_folder: z.boolean().optional(),
    mime_type: z.string().max(255).optional(),
    created_by: z.string().regex(/^[a-z0-9]+$/).length(15),
    size: z.number().optional(),
    file: z.string().optional(),
    description: z.string().max(2000).optional(),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
    parent: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    thumbnail: z.string().optional(),
})

export const driveShareLinksSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    item: z.string().regex(/^[a-z0-9]+$/).length(15),
    token: z.string().length(64),
    created_by: z.string().regex(/^[a-z0-9]+$/).length(15),
    role: z.enum(["viewer", "editor"]),
    expires_at: z.string().regex(DATETIME_REGEX).optional(),
    is_active: z.boolean().optional(),
    download_count: z.number().optional(),
    last_accessed_at: z.string().regex(DATETIME_REGEX).optional(),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
})

export const driveSharesSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    item: z.string().regex(/^[a-z0-9]+$/).length(15),
    user_org: z.string().regex(/^[a-z0-9]+$/).length(15),
    role: z.enum(["owner", "editor", "viewer"]),
    created_by: z.string().regex(/^[a-z0-9]+$/).length(15),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
})

export const inviteTokensSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    token: z.string().length(64),
    user: z.string().regex(/^[a-z0-9]+$/).length(15),
    org: z.string().regex(/^[a-z0-9]+$/).length(15),
    role: z.string().min(1).max(40),
    expires_at: z.string().regex(DATETIME_REGEX),
    used_at: z.string().regex(DATETIME_REGEX).optional(),
    created_by: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
})

export const labelAssignmentsSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    label: z.string().regex(/^[a-z0-9]+$/).length(15),
    record_id: z.string().min(1),
    collection: z.string().min(1),
    user_org: z.string().regex(/^[a-z0-9]+$/).length(15),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
})

export const labelsSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    org: z.string().regex(/^[a-z0-9]+$/).length(15),
    name: z.string().min(1).max(100),
    color: z.string().min(1).max(20),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
    user_org: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
})

export const mailDomainsSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    org: z.string().regex(/^[a-z0-9]+$/).length(15),
    domain: z.string().min(3).max(253),
    verified: z.boolean().optional(),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
    mx_verified: z.boolean().optional(),
    inbound_domain_verified: z.boolean().optional(),
    spf_verified: z.boolean().optional(),
    dkim_verified: z.boolean().optional(),
    return_path_verified: z.boolean().optional(),
    last_checked_at: z.string().max(40).optional(),
    verification_details: z.unknown().optional(),
    webhook_secret: z.string().max(64).optional(),
})

export const mailFolderCountsSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).min(1),
    user_org: z.string().regex(/^[a-z0-9]+$/).length(15),
    mailbox: z.string().regex(/^[a-z0-9]+$/).length(15),
    inbox: z.unknown().optional(),
    drafts: z.unknown().optional(),
    sent: z.unknown().optional(),
    starred: z.unknown().optional(),
    trash: z.unknown().optional(),
    spam: z.unknown().optional(),
})

export const mailImapMailboxStateSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    mailbox: z.string().regex(/^[a-z0-9]+$/).length(15),
    uid_validity: z.number().min(1).refine((n) => n !== 0),
    uid_next: z.number().min(1).refine((n) => n !== 0),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
})

export const mailMailboxAliasesSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    mailbox: z.string().regex(/^[a-z0-9]+$/).length(15),
    address: z.string().regex(/^[a-z0-9._-]+$/).min(1).max(64),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
})

export const mailMailboxMembersSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    mailbox: z.string().regex(/^[a-z0-9]+$/).length(15),
    user_org: z.string().regex(/^[a-z0-9]+$/).length(15),
    role: z.enum(["owner", "member"]),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
})

export const mailMailboxesSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    address: z.string().min(1).max(64),
    domain: z.string().regex(/^[a-z0-9]+$/).length(15),
    display_name: z.string().max(200).optional(),
    type: z.enum(["personal", "shared"]),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
    name: z.string().max(100).optional(),
})

export const mailMessagesSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    thread: z.string().regex(/^[a-z0-9]+$/).length(15),
    message_id: z.string().max(995).optional(),
    in_reply_to: z.string().max(995).optional(),
    sender_name: z.string().max(200).optional(),
    sender_email: z.string().min(1).max(320),
    recipients_to: z.unknown().optional(),
    recipients_cc: z.unknown().optional(),
    date: z.string().regex(DATETIME_REGEX),
    subject: z.string().max(998).optional(),
    snippet: z.string().max(300).optional(),
    has_attachments: z.boolean().optional(),
    body_html: z.string().optional(),
    attachments: z.string().array().max(20).optional(),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
    delivery_status: z.enum(["sending", "sent", "delivered", "bounced", "spam_complaint", "draft"]).optional(),
    bounce_reason: z.string().max(500).optional(),
    imap_uid: z.number().optional(),
    raw_headers: z.string().optional(),
    total_size: z.number().optional(),
    alias: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    cid_map: z.unknown().optional(),
    attachment_thumbnails: z.string().array().max(20).optional(),
    attachment_thumbnail_map: z.unknown().optional(),
})

export const mailThreadStateSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    thread: z.string().regex(/^[a-z0-9]+$/).length(15),
    user_org: z.string().regex(/^[a-z0-9]+$/).length(15),
    folder: z.enum(["inbox", "sent", "drafts", "trash", "spam", "archive"]),
    is_read: z.boolean().optional(),
    is_starred: z.boolean().optional(),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
})

export const mailThreadsSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    mailbox: z.string().regex(/^[a-z0-9]+$/).length(15),
    subject: z.string().min(1).max(998),
    snippet: z.string().max(300).optional(),
    message_count: z.number().optional(),
    latest_date: z.string().regex(DATETIME_REGEX).optional(),
    participants: z.unknown().optional(),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
    has_draft: z.boolean().optional(),
    has_attachments: z.boolean().optional(),
})

export const notificationsSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    user: z.string().regex(/^[a-z0-9]+$/).length(15),
    org: z.string().regex(/^[a-z0-9]+$/).length(15),
    type: z.string().min(1).max(100),
    package: z.string().max(100).optional(),
    title: z.string().min(1).max(200),
    body: z.string().max(1000).optional(),
    url: z.string().max(500).optional(),
    metadata: z.unknown().optional(),
    read: z.boolean().optional(),
    dismissed: z.boolean().optional(),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
})

export const orgPkgAccessSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    user_org: z.string().regex(/^[a-z0-9]+$/).length(15),
    pkg: z.string().min(1).max(100),
    access: z.enum(["full", "readonly", "none"]),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
})

export const orgPkgEnabledSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    org: z.string().regex(/^[a-z0-9]+$/).length(15),
    pkg: z.string().min(1).max(100),
    enabled: z.boolean().optional(),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
})

export const orgsSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    name: z.string().min(1).max(200),
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).min(1).max(100),
    logo: z.string().optional(),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
})

export const pkgInstallLogSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    action: z.enum(["install", "uninstall", "enable", "disable"]),
    pkg_slug: z.string().min(1).max(100),
    npm_package: z.string().max(500).optional(),
    version: z.string().max(50).optional(),
    status: z.enum(["pending", "running", "success", "failed", "rolled_back"]),
    log: z.string().optional(),
    error: z.string().max(5000).optional(),
    initiated_by: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    started_at: z.string().regex(DATETIME_REGEX).optional(),
    completed_at: z.string().regex(DATETIME_REGEX).optional(),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
})

export const pkgRegistrySchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    name: z.string().min(1).max(200),
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).min(1).max(100),
    npm_package: z.string().max(500).optional(),
    version: z.string().max(50).optional(),
    status: z.enum(["bundled", "available", "installed", "disabled"]),
    manifest_json: z.unknown().optional(),
    has_server: z.boolean().optional(),
    icon: z.string().max(100).optional(),
    description: z.string().max(1000).optional(),
    nav_order: z.number().optional(),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
})

export const pushSubscriptionsSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    user: z.string().regex(/^[a-z0-9]+$/).length(15),
    endpoint: z.string().url(),
    keys: z.unknown(),
    user_agent: z.string().max(500).optional(),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
    platform: z.enum(["web", "expo"]),
    expo_token: z.string().max(500).optional(),
})

export const realtimeDocUpdatesSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    room_kind: z.string().min(1).max(64),
    room_id: z.string().min(1).max(64),
    seq: z.number().int().min(1).refine((n) => n !== 0),
    update: z.string().min(1).max(358400),
    created: z.string().regex(DATETIME_REGEX).optional(),
})

export const settingsSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    app: z.string().min(1).max(100),
    key: z.string().min(1).max(200),
    value: z.unknown().optional(),
    org: z.string().regex(/^[a-z0-9]+$/).length(15),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
})

export const textCommentsSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    drive_item: z.string().regex(/^[a-z0-9]+$/).length(15),
    comment_id: z.string().min(1).max(64),
    quoted_text: z.string().max(280).optional(),
    body: z.string().min(1).max(4000),
    resolved_at: z.string().regex(DATETIME_REGEX).optional(),
    author: z.string().regex(/^[a-z0-9]+$/).length(15),
    author_name: z.string().min(1).max(200),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
    parent_comment: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
})

export const userOrgSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    org: z.string().regex(/^[a-z0-9]+$/).length(15),
    user: z.string().regex(/^[a-z0-9]+$/).length(15),
    role: z.enum(["owner", "admin", "member", "guest"]),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
    created_by: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
})

export const userPreferencesSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    app: z.string().min(1).max(100),
    key: z.string().min(1).max(200),
    value: z.unknown().optional(),
    user: z.string().regex(/^[a-z0-9]+$/).length(15),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
})

export const usersSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+$/).length(15).optional(),
    password: z.string().min(8),
    tokenKey: z.string().min(30).max(60).optional(),
    email: z.string().email().optional(),
    emailVisibility: z.boolean().optional(),
    verified: z.boolean().optional(),
    name: z.string().min(1).max(255),
    avatar: z.string().optional(),
    created: z.string().regex(DATETIME_REGEX).optional(),
    updated: z.string().regex(DATETIME_REGEX).optional(),
    is_demo: z.boolean().optional(),
    username: z.string().regex(/^[a-z0-9][a-z0-9_-]{2,31}$/).min(3).max(32),
    metadata: z.unknown().optional(),
})

