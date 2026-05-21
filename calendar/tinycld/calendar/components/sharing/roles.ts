// Calendar membership roles. Mirrors the schema enum on calendar_members.role.
// Owner conflates Google's "Owner" and "Make changes and manage sharing"
// (full control + member management). Editor matches "Make changes to events".
// Viewer matches "See all event details".

export type CalendarRole = 'owner' | 'editor' | 'viewer'

export interface RoleOption {
    value: CalendarRole
    label: string
    description: string
}

export const ROLE_OPTIONS: RoleOption[] = [
    {
        value: 'owner',
        label: 'Owner',
        description: 'Full control, manage members',
    },
    {
        value: 'editor',
        label: 'Editor',
        description: 'Add, edit, and delete events',
    },
    {
        value: 'viewer',
        label: 'Viewer',
        description: 'See all event details',
    },
]

export function roleLabel(role: CalendarRole): string {
    return ROLE_OPTIONS.find(o => o.value === role)?.label ?? role
}
