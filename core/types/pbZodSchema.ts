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

