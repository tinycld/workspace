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
    contacts: {
        type: Contacts
        relations: {
            owner: UserOrg
        }
    }
    demo_leads: {
        type: DemoLeads
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
            // invite_tokens_via_org?: InviteTokens[]
            // labels_via_org?: Labels[]
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
    user_org: {
        type: UserOrg
        relations: {
            // contacts_via_owner?: Contacts[]
            // label_assignments_via_user_org?: LabelAssignments[]
            // labels_via_user_org?: Labels[]
            // org_pkg_access_via_user_org?: OrgPkgAccess[]
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

