export interface AuditLogs {
    id: string
    org: string
    actor: string
    action: 'created' | 'updated' | 'deleted'
    resource_type: string
    resource_id: string
    resource_label: string
    changes: any
    snapshot: any
    ip_address: string
    user_agent: string
    metadata: any
    created: string
    updated: string
}

export interface CalcComments {
    id: string
    drive_item: string
    sheet_id: string
    row: number
    col: number
    body: string
    resolved_at: string
    author: string
    author_name: string
    created: string
    updated: string
    parent_comment: string
}

export interface CalendarCalendars {
    id: string
    org: string
    name: string
    description: string
    color: 'blue' | 'green' | 'red' | 'teal' | 'purple' | 'orange' | 'tomato' | 'flamingo' | 'tangerine' | 'banana' | 'sage' | 'basil' | 'peacock' | 'blueberry' | 'lavender' | 'grape' | 'graphite'
    created: string
    updated: string
    subscription_url: string
    subscription_last_sync: string
    subscription_error: string
}

export interface CalendarEvents {
    id: string
    calendar: string
    created_by: string
    title: string
    description: string
    location: string
    start: string
    end: string
    all_day: boolean
    recurrence: string
    guests: any
    reminder: number
    busy_status: 'busy' | 'free'
    visibility: 'default' | 'public' | 'private'
    created: string
    updated: string
    ical_uid: string
    recurrence_until: string
}

export interface CalendarMembers {
    id: string
    calendar: string
    user_org: string
    role: 'owner' | 'editor' | 'viewer'
    created: string
    updated: string
    color: 'blue' | 'green' | 'red' | 'teal' | 'purple' | 'orange' | 'tomato' | 'flamingo' | 'tangerine' | 'banana' | 'sage' | 'basil' | 'peacock' | 'blueberry' | 'lavender' | 'grape' | 'graphite'
}

export interface CommentMentions {
    id: string
    comment_collection: string
    comment_record: string
    drive_item: string
    mentioned_user_org: string
    created: string
}

export interface Contacts {
    id: string
    email: string
    phone: string
    owner: string
    notes: string
    created: string
    updated: string
    first_name: string
    last_name: string
    company: string
    job_title: string
    favorite: boolean
    vcard_uid: string
    deleted_at: string
}

export interface DemoLeads {
    id: string
    email: string
    reason: string
    source: 'intro_modal' | 'banner_link'
    user_agent: string
    ip: string
    created: string
}

export interface DriveItemState {
    id: string
    item: string
    user_org: string
    is_starred: boolean
    trashed_at: string
    last_viewed_at: string
    created: string
    updated: string
}

export interface DriveItemVersions {
    id: string
    item: string
    version_number: number
    file: string
    size: number
    mime_type: string
    source: 'upload' | 'system'
    label: string
    created_by: string
    created: string
    updated: string
}

export interface DriveItems {
    id: string
    org: string
    name: string
    is_folder: boolean
    mime_type: string
    created_by: string
    size: number
    file: string
    description: string
    created: string
    updated: string
    parent: string
    thumbnail: string
}

export interface DriveShareLinks {
    id: string
    item: string
    token: string
    created_by: string
    role: 'viewer' | 'editor'
    expires_at: string
    is_active: boolean
    download_count: number
    last_accessed_at: string
    created: string
    updated: string
}

export interface DriveShares {
    id: string
    item: string
    user_org: string
    role: 'owner' | 'editor' | 'viewer'
    created_by: string
    created: string
    updated: string
}

export interface InviteTokens {
    id: string
    token: string
    user: string
    org: string
    role: string
    expires_at: string
    used_at: string
    created_by: string
    created: string
    updated: string
}

export interface LabelAssignments {
    id: string
    label: string
    record_id: string
    collection: string
    user_org: string
    created: string
    updated: string
}

export interface Labels {
    id: string
    org: string
    name: string
    color: string
    created: string
    updated: string
    user_org: string
}

export interface MailDomains {
    id: string
    org: string
    domain: string
    verified: boolean
    created: string
    updated: string
    mx_verified: boolean
    inbound_domain_verified: boolean
    spf_verified: boolean
    dkim_verified: boolean
    return_path_verified: boolean
    last_checked_at: string
    verification_details: any
    webhook_secret: string
}

export interface MailFolderCounts {
    id: string
    user_org: string
    mailbox: string
    inbox: any
    drafts: any
    sent: any
    starred: any
    trash: any
    spam: any
}

export interface MailImapMailboxState {
    id: string
    mailbox: string
    uid_validity: number
    uid_next: number
    created: string
    updated: string
}

export interface MailMailboxAliases {
    id: string
    mailbox: string
    address: string
    created: string
    updated: string
}

export interface MailMailboxMembers {
    id: string
    mailbox: string
    user_org: string
    role: 'owner' | 'member'
    created: string
    updated: string
}

export interface MailMailboxes {
    id: string
    address: string
    domain: string
    display_name: string
    type: 'personal' | 'shared'
    created: string
    updated: string
    name: string
}

export interface MailMessages {
    id: string
    thread: string
    message_id: string
    in_reply_to: string
    sender_name: string
    sender_email: string
    recipients_to: any
    recipients_cc: any
    date: string
    subject: string
    snippet: string
    has_attachments: boolean
    body_html: string
    attachments: string[]
    created: string
    updated: string
    delivery_status: 'sending' | 'sent' | 'delivered' | 'bounced' | 'spam_complaint' | 'draft'
    bounce_reason: string
    imap_uid: number
    raw_headers: string
    total_size: number
    alias: string
    cid_map: any
    attachment_thumbnails: string[]
    attachment_thumbnail_map: any
}

export interface MailThreadState {
    id: string
    thread: string
    user_org: string
    folder: 'inbox' | 'sent' | 'drafts' | 'trash' | 'spam' | 'archive'
    is_read: boolean
    is_starred: boolean
    created: string
    updated: string
}

export interface MailThreads {
    id: string
    mailbox: string
    subject: string
    snippet: string
    message_count: number
    latest_date: string
    participants: any
    created: string
    updated: string
    has_draft: boolean
    has_attachments: boolean
}

export interface Notifications {
    id: string
    user: string
    org: string
    type: string
    package: string
    title: string
    body: string
    url: string
    metadata: any
    read: boolean
    dismissed: boolean
    created: string
    updated: string
}

export interface OrgPkgAccess {
    id: string
    user_org: string
    pkg: string
    access: 'full' | 'readonly' | 'none'
    created: string
    updated: string
}

export interface OrgPkgEnabled {
    id: string
    org: string
    pkg: string
    enabled: boolean
    created: string
    updated: string
}

export interface Orgs {
    id: string
    name: string
    slug: string
    logo: string
    created: string
    updated: string
}

export interface PkgInstallLog {
    id: string
    action: 'install' | 'uninstall' | 'enable' | 'disable'
    pkg_slug: string
    npm_package: string
    version: string
    status: 'pending' | 'running' | 'success' | 'failed' | 'rolled_back'
    log: string
    error: string
    initiated_by: string
    started_at: string
    completed_at: string
    created: string
    updated: string
}

export interface PkgRegistry {
    id: string
    name: string
    slug: string
    npm_package: string
    version: string
    status: 'bundled' | 'available' | 'installed' | 'disabled'
    manifest_json: any
    has_server: boolean
    icon: string
    description: string
    nav_order: number
    created: string
    updated: string
}

export interface PushSubscriptions {
    id: string
    user: string
    endpoint: string
    keys: any
    user_agent: string
    created: string
    updated: string
    platform: 'web' | 'expo'
    expo_token: string
}

export interface RealtimeDocUpdates {
    id: string
    room_kind: string
    room_id: string
    seq: number
    update: string
    created: string
}

export interface Settings {
    id: string
    app: string
    key: string
    value: any
    org: string
    created: string
    updated: string
}

export interface TextComments {
    id: string
    drive_item: string
    comment_id: string
    quoted_text: string
    body: string
    resolved_at: string
    author: string
    author_name: string
    created: string
    updated: string
    parent_comment: string
}

export interface UserOrg {
    id: string
    org: string
    user: string
    role: 'owner' | 'admin' | 'member' | 'guest'
    created: string
    updated: string
    created_by: string
}

export interface UserPreferences {
    id: string
    app: string
    key: string
    value: any
    user: string
    created: string
    updated: string
}

export interface Users {
    id: string
    password: string
    tokenKey: string
    email: string
    emailVisibility: boolean
    verified: boolean
    name: string
    avatar: string
    created: string
    updated: string
    is_demo: boolean
    username: string
    metadata: any
}


/**
* Commented-out back-relations are what will be inferred by pocketbase-ts from the forward relations.
*
* The "UNIQUE index constraint" case is automatically handled by this hook,
* but if you want to make a back-relation non-nullable, you can uncomment it and remove the "?".
*
* See https://github.com/satohshi/pocketbase-ts#back-relations for more information.
*/
export type Schema = {
    audit_logs: {
        type: AuditLogs
        relations: {
            org: Orgs
            actor?: Users
        }
    }
    calc_comments: {
        type: CalcComments
        relations: {
            drive_item: DriveItems
            author: UserOrg
            parent_comment?: CalcComments
            // calc_comments_via_parent_comment?: CalcComments[]
        }
    }
    calendar_calendars: {
        type: CalendarCalendars
        relations: {
            org: Orgs
            // calendar_events_via_calendar?: CalendarEvents[]
            // calendar_members_via_calendar?: CalendarMembers[]
        }
    }
    calendar_events: {
        type: CalendarEvents
        relations: {
            calendar: CalendarCalendars
            created_by: UserOrg
        }
    }
    calendar_members: {
        type: CalendarMembers
        relations: {
            calendar: CalendarCalendars
            user_org: UserOrg
        }
    }
    comment_mentions: {
        type: CommentMentions
        relations: {
            drive_item: DriveItems
            mentioned_user_org: UserOrg
        }
    }
    contacts: {
        type: Contacts
        relations: {
            owner: UserOrg
        }
    }
    demo_leads: {
        type: DemoLeads
    }
    drive_item_state: {
        type: DriveItemState
        relations: {
            item: DriveItems
            user_org: UserOrg
        }
    }
    drive_item_versions: {
        type: DriveItemVersions
        relations: {
            item: DriveItems
            created_by: UserOrg
        }
    }
    drive_items: {
        type: DriveItems
        relations: {
            // calc_comments_via_drive_item?: CalcComments[]
            // comment_mentions_via_drive_item?: CommentMentions[]
            // drive_item_state_via_item?: DriveItemState[]
            // drive_item_versions_via_item?: DriveItemVersions[]
            org: Orgs
            created_by: UserOrg
            parent?: DriveItems
            // drive_items_via_parent?: DriveItems[]
            // drive_share_links_via_item?: DriveShareLinks[]
            // drive_shares_via_item?: DriveShares[]
            // text_comments_via_drive_item?: TextComments[]
        }
    }
    drive_share_links: {
        type: DriveShareLinks
        relations: {
            item: DriveItems
            created_by: UserOrg
        }
    }
    drive_shares: {
        type: DriveShares
        relations: {
            item: DriveItems
            user_org: UserOrg
            created_by: UserOrg
        }
    }
    invite_tokens: {
        type: InviteTokens
        relations: {
            user: Users
            org: Orgs
            created_by?: Users
        }
    }
    label_assignments: {
        type: LabelAssignments
        relations: {
            label: Labels
            user_org: UserOrg
        }
    }
    labels: {
        type: Labels
        relations: {
            // label_assignments_via_label?: LabelAssignments[]
            org: Orgs
            user_org?: UserOrg
        }
    }
    mail_domains: {
        type: MailDomains
        relations: {
            org: Orgs
            // mail_mailboxes_via_domain?: MailMailboxes[]
        }
    }
    mail_folder_counts: {
        type: MailFolderCounts
        relations: {
            user_org: UserOrg
            mailbox: MailMailboxes
        }
    }
    mail_imap_mailbox_state: {
        type: MailImapMailboxState
        relations: {
            mailbox: MailMailboxes
        }
    }
    mail_mailbox_aliases: {
        type: MailMailboxAliases
        relations: {
            mailbox: MailMailboxes
            // mail_messages_via_alias?: MailMessages[]
        }
    }
    mail_mailbox_members: {
        type: MailMailboxMembers
        relations: {
            mailbox: MailMailboxes
            user_org: UserOrg
        }
    }
    mail_mailboxes: {
        type: MailMailboxes
        relations: {
            // mail_folder_counts_via_mailbox?: MailFolderCounts[]
            mail_imap_mailbox_state_via_mailbox?: MailImapMailboxState
            // mail_mailbox_aliases_via_mailbox?: MailMailboxAliases[]
            // mail_mailbox_members_via_mailbox?: MailMailboxMembers[]
            domain: MailDomains
            // mail_threads_via_mailbox?: MailThreads[]
        }
    }
    mail_messages: {
        type: MailMessages
        relations: {
            thread: MailThreads
            alias?: MailMailboxAliases
        }
    }
    mail_thread_state: {
        type: MailThreadState
        relations: {
            thread: MailThreads
            user_org: UserOrg
        }
    }
    mail_threads: {
        type: MailThreads
        relations: {
            // mail_messages_via_thread?: MailMessages[]
            // mail_thread_state_via_thread?: MailThreadState[]
            mailbox: MailMailboxes
        }
    }
    notifications: {
        type: Notifications
        relations: {
            user: Users
            org: Orgs
        }
    }
    org_pkg_access: {
        type: OrgPkgAccess
        relations: {
            user_org: UserOrg
        }
    }
    org_pkg_enabled: {
        type: OrgPkgEnabled
        relations: {
            org: Orgs
        }
    }
    orgs: {
        type: Orgs
        relations: {
            // audit_logs_via_org?: AuditLogs[]
            // calendar_calendars_via_org?: CalendarCalendars[]
            // drive_items_via_org?: DriveItems[]
            // invite_tokens_via_org?: InviteTokens[]
            // labels_via_org?: Labels[]
            // mail_domains_via_org?: MailDomains[]
            // notifications_via_org?: Notifications[]
            // org_pkg_enabled_via_org?: OrgPkgEnabled[]
            // settings_via_org?: Settings[]
            // user_org_via_org?: UserOrg[]
        }
    }
    pkg_install_log: {
        type: PkgInstallLog
        relations: {
            initiated_by?: Users
        }
    }
    pkg_registry: {
        type: PkgRegistry
    }
    push_subscriptions: {
        type: PushSubscriptions
        relations: {
            user: Users
        }
    }
    realtime_doc_updates: {
        type: RealtimeDocUpdates
    }
    settings: {
        type: Settings
        relations: {
            org: Orgs
        }
    }
    text_comments: {
        type: TextComments
        relations: {
            drive_item: DriveItems
            author: UserOrg
            parent_comment?: TextComments
            // text_comments_via_parent_comment?: TextComments[]
        }
    }
    user_org: {
        type: UserOrg
        relations: {
            // calc_comments_via_author?: CalcComments[]
            // calendar_events_via_created_by?: CalendarEvents[]
            // calendar_members_via_user_org?: CalendarMembers[]
            // comment_mentions_via_mentioned_user_org?: CommentMentions[]
            // contacts_via_owner?: Contacts[]
            // drive_item_state_via_user_org?: DriveItemState[]
            // drive_item_versions_via_created_by?: DriveItemVersions[]
            // drive_items_via_created_by?: DriveItems[]
            // drive_share_links_via_created_by?: DriveShareLinks[]
            // drive_shares_via_user_org?: DriveShares[]
            // drive_shares_via_created_by?: DriveShares[]
            // label_assignments_via_user_org?: LabelAssignments[]
            // labels_via_user_org?: Labels[]
            // mail_folder_counts_via_user_org?: MailFolderCounts[]
            // mail_mailbox_members_via_user_org?: MailMailboxMembers[]
            // mail_thread_state_via_user_org?: MailThreadState[]
            // org_pkg_access_via_user_org?: OrgPkgAccess[]
            // text_comments_via_author?: TextComments[]
            org: Orgs
            user: Users
            created_by?: Users
        }
    }
    user_preferences: {
        type: UserPreferences
        relations: {
            user: Users
        }
    }
    users: {
        type: Users
        relations: {
            // audit_logs_via_actor?: AuditLogs[]
            // invite_tokens_via_user?: InviteTokens[]
            // invite_tokens_via_created_by?: InviteTokens[]
            // notifications_via_user?: Notifications[]
            // pkg_install_log_via_initiated_by?: PkgInstallLog[]
            // push_subscriptions_via_user?: PushSubscriptions[]
            // user_org_via_user?: UserOrg[]
            // user_org_via_created_by?: UserOrg[]
            // user_preferences_via_user?: UserPreferences[]
        }
    }
}

