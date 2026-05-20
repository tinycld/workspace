export type OrgRole = 'owner' | 'admin' | 'member' | 'guest'

export interface MemberRow {
    userOrgId: string
    userId: string
    username: string
    name: string
    email: string
    role: OrgRole
    isPending: boolean
    isDemo: boolean
}

export type DrawerMode =
    | { kind: 'closed' }
    | { kind: 'invite' }
    | { kind: 'view'; userOrgId: string }

export const ROLE_DESCRIPTIONS: Record<OrgRole, string> = {
    owner: 'Full control — including billing and deleting the organization.',
    admin: 'Can manage members, settings, and all organization data.',
    member: 'Can use the organization day-to-day across installed packages.',
    guest: 'Limited access. Scoped to whatever you grant per package.',
}

export const ROLE_SWATCH: Record<OrgRole, { fg: string; bg: string; ring: string }> = {
    owner: { fg: '#7c3aed', bg: 'rgba(124, 58, 237, 0.12)', ring: 'rgba(124, 58, 237, 0.35)' },
    admin: { fg: '#2563eb', bg: 'rgba(37, 99, 235, 0.12)', ring: 'rgba(37, 99, 235, 0.35)' },
    member: { fg: '#059669', bg: 'rgba(5, 150, 105, 0.12)', ring: 'rgba(5, 150, 105, 0.35)' },
    guest: { fg: '#ea580c', bg: 'rgba(234, 88, 12, 0.12)', ring: 'rgba(234, 88, 12, 0.35)' },
}

export const ROLE_ORDER: OrgRole[] = ['owner', 'admin', 'member', 'guest']

export const ROLE_LABELS: Record<OrgRole, string> = {
    owner: 'Owner',
    admin: 'Admin',
    member: 'Member',
    guest: 'Guest',
}
