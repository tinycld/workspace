import { and, eq } from '@tanstack/db'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useCurrentRole } from '@tinycld/core/lib/use-current-role'
import { useNavigateBack } from '@tinycld/core/lib/use-navigate-back'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'

const ACTION_OPTIONS = [
    { label: 'All', value: '' },
    { label: 'Created', value: 'created' },
    { label: 'Updated', value: 'updated' },
    { label: 'Deleted', value: 'deleted' },
] as const

const RESOURCE_TYPE_OPTIONS = [
    { label: 'All', value: '' },
    { label: 'Contacts', value: 'contacts' },
    { label: 'Calendar', value: 'calendar_events' },
    { label: 'Calendars', value: 'calendar_calendars' },
    { label: 'Drive', value: 'drive_items' },
    { label: 'Mail', value: 'mail_messages' },
    { label: 'Mailboxes', value: 'mail_mailboxes' },
    { label: 'Domains', value: 'mail_domains' },
    { label: 'Members', value: 'user_org' },
    { label: 'Labels', value: 'labels' },
    { label: 'Settings', value: 'settings' },
    { label: 'Packages', value: 'org_pkg_enabled' },
] as const

const ACTION_BADGE_COLORS = {
    created: { bg: 'rgba(34, 197, 94, 0.15)', text: '#22c55e' },
    updated: { bg: 'rgba(59, 130, 246, 0.15)', text: '#3b82f6' },
    deleted: { bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444' },
} as const

export default function AuditLogSettings() {
    const orgHref = useOrgHref()
    const navigateBack = useNavigateBack(() => orgHref('settings'))
    const { isAdmin } = useCurrentRole()
    const [actionFilter, setActionFilter] = useState('')
    const [resourceFilter, setResourceFilter] = useState('')

    const fgColor = useThemeColor('foreground')

    if (!isAdmin) {
        return (
            <View className="flex-1 p-5 items-center justify-center bg-background">
                <Text className="text-muted-foreground text-base">
                    Only admins can view audit logs.
                </Text>
            </View>
        )
    }

    return (
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} className="bg-background">
            <View className="flex-1 p-5 max-w-[700px]">
                <View className="flex-row gap-3 items-center mb-5">
                    <Pressable onPress={navigateBack}>
                        <ArrowLeft size={24} color={fgColor} />
                    </Pressable>
                    <Text className="text-foreground text-[22px] font-bold">Audit Log</Text>
                </View>

                <FilterBar
                    actionFilter={actionFilter}
                    onActionChange={setActionFilter}
                    resourceFilter={resourceFilter}
                    onResourceChange={setResourceFilter}
                />

                <AuditLogList actionFilter={actionFilter} resourceFilter={resourceFilter} />
            </View>
        </ScrollView>
    )
}

function FilterBar({
    actionFilter,
    onActionChange,
    resourceFilter,
    onResourceChange,
}: {
    actionFilter: string
    onActionChange: (v: string) => void
    resourceFilter: string
    onResourceChange: (v: string) => void
}) {
    return (
        <View className="mb-4 gap-3">
            <View className="gap-1.5">
                <FilterLabel text="Action" />
                <View className="flex-row gap-1.5 flex-wrap">
                    {ACTION_OPTIONS.map(opt => (
                        <FilterChip
                            key={opt.value}
                            label={opt.label}
                            isActive={actionFilter === opt.value}
                            onPress={() => onActionChange(opt.value)}
                        />
                    ))}
                </View>
            </View>
            <View className="gap-1.5">
                <FilterLabel text="Resource" />
                <View className="flex-row gap-1.5 flex-wrap">
                    {RESOURCE_TYPE_OPTIONS.map(opt => (
                        <FilterChip
                            key={opt.value}
                            label={opt.label}
                            isActive={resourceFilter === opt.value}
                            onPress={() => onResourceChange(opt.value)}
                        />
                    ))}
                </View>
            </View>
        </View>
    )
}

function FilterLabel({ text }: { text: string }) {
    return <Text className="text-muted-foreground text-xs font-semibold">{text}</Text>
}

function FilterChip({
    label,
    isActive,
    onPress,
}: {
    label: string
    isActive: boolean
    onPress: () => void
}) {
    return (
        <Pressable
            onPress={onPress}
            className={`px-2.5 py-1 rounded-md ${isActive ? 'bg-primary' : 'border border-border'}`}
        >
            <Text className={`text-xs ${isActive ? 'text-primary-foreground' : 'text-primary'}`}>
                {label}
            </Text>
        </Pressable>
    )
}

function AuditLogList({
    actionFilter,
    resourceFilter,
}: {
    actionFilter: string
    resourceFilter: string
}) {
    const [auditLogsCollection] = useStore('audit_logs')

    const { data: logs } = useOrgLiveQuery(
        (query, { orgId }) => {
            const q = query
                .from({ audit_logs: auditLogsCollection })
                .where(({ audit_logs }) => {
                    let condition = eq(audit_logs.org, orgId)
                    if (actionFilter) {
                        condition = and(condition, eq(audit_logs.action, actionFilter))
                    }
                    if (resourceFilter) {
                        condition = and(condition, eq(audit_logs.resource_type, resourceFilter))
                    }
                    return condition
                })
                .orderBy(({ audit_logs }) => audit_logs.created, 'desc')

            return q
        },
        [actionFilter, resourceFilter]
    )

    if (!logs || logs.length === 0) {
        return (
            <Text className="text-muted-foreground text-sm mt-2">No audit log entries found.</Text>
        )
    }

    return (
        <View className="rounded-xl border border-border overflow-hidden bg-surface-secondary">
            {logs.map(entry => (
                <AuditLogRow key={entry.id} entry={entry} />
            ))}
        </View>
    )
}

interface AuditEntry {
    id: string
    action: 'created' | 'updated' | 'deleted'
    resource_type: string
    resource_id: string
    resource_label: string
    changes: Record<string, { before?: unknown; after?: unknown; redacted?: boolean }> | null
    snapshot: Record<string, unknown> | null
    created: string
    expand?: { actor?: { name: string; email: string } }
}

function AuditLogRow({ entry }: { entry: AuditEntry }) {
    const [expanded, setExpanded] = useState(false)
    const mutedColor = useThemeColor('muted-foreground')

    const actorName = entry.expand?.actor?.name || entry.expand?.actor?.email || 'System'
    const actionColors = ACTION_BADGE_COLORS[entry.action as keyof typeof ACTION_BADGE_COLORS]
    const hasDetails = Boolean(
        (entry.action === 'updated' && entry.changes && Object.keys(entry.changes).length > 0) ||
            (entry.action === 'deleted' && entry.snapshot && Object.keys(entry.snapshot).length > 0)
    )

    const resourceLabel = formatResourceType(entry.resource_type)

    return (
        <View className="border-b border-border">
            <Pressable
                className="px-4 py-3 flex-row items-center gap-3"
                onPress={() => hasDetails && setExpanded(!expanded)}
            >
                <View className="flex-1 gap-1">
                    <View className="flex-row gap-2 items-center flex-wrap">
                        <Text className="text-foreground text-sm font-semibold">{actorName}</Text>
                        <ActionBadge action={entry.action} colors={actionColors} />
                        <Text className="text-muted-foreground text-[13px]">{resourceLabel}</Text>
                    </View>
                    <EntryLabel isVisible={!!entry.resource_label} label={entry.resource_label} />
                    <Text className="text-muted-foreground text-xs">
                        {formatRelativeTime(entry.created)}
                    </Text>
                </View>
                <ExpandIcon isVisible={hasDetails} expanded={expanded} color={mutedColor} />
            </Pressable>

            <AuditDetails
                isVisible={expanded}
                action={entry.action}
                changes={entry.changes}
                snapshot={entry.snapshot}
            />
        </View>
    )
}

function EntryLabel({ isVisible, label }: { isVisible: boolean; label: string }) {
    if (!isVisible) return null
    return <Text className="text-foreground text-[13px]">{label}</Text>
}

function ExpandIcon({
    isVisible,
    expanded,
    color,
}: {
    isVisible: boolean
    expanded: boolean
    color: string
}) {
    if (!isVisible) return null
    return expanded ? (
        <ChevronUp size={16} color={color} />
    ) : (
        <ChevronDown size={16} color={color} />
    )
}

function ActionBadge({ action, colors }: { action: string; colors: { bg: string; text: string } }) {
    return (
        <View className="rounded px-1.5 py-0.5" style={{ backgroundColor: colors.bg }}>
            <Text className="text-[11px] font-semibold" style={{ color: colors.text }}>
                {action}
            </Text>
        </View>
    )
}

function AuditDetails({
    isVisible,
    action,
    changes,
    snapshot,
}: {
    isVisible: boolean
    action: string
    changes: Record<string, { before?: unknown; after?: unknown; redacted?: boolean }> | null
    snapshot: Record<string, unknown> | null
}) {
    if (!isVisible) return null

    if (action === 'updated' && changes) {
        return (
            <View className="px-4 pb-3 gap-1.5">
                {Object.entries(changes).map(([field, change]) => (
                    <View key={field} className="rounded-md p-2 bg-surface-secondary">
                        <Text className="text-foreground text-xs font-semibold">{field}</Text>
                        <ChangeDetail isVisible={!change.redacted} change={change} />
                        <RedactedLabel isVisible={!!change.redacted} />
                    </View>
                ))}
            </View>
        )
    }

    if (action === 'deleted' && snapshot) {
        return (
            <View className="px-4 pb-3 gap-1.5">
                {Object.entries(snapshot).map(([field, value]) => (
                    <View key={field} className="flex-row gap-2">
                        <Text className="text-muted-foreground text-xs font-semibold">
                            {field}:
                        </Text>
                        <Text className="flex-1 text-foreground text-xs">{formatValue(value)}</Text>
                    </View>
                ))}
            </View>
        )
    }

    return null
}

function ChangeDetail({
    isVisible,
    change,
}: {
    isVisible: boolean
    change: { before?: unknown; after?: unknown }
}) {
    if (!isVisible) return null

    return (
        <View className="gap-0.5 mt-1">
            <Text className="text-danger text-[11px]">- {formatValue(change.before)}</Text>
            <Text className="text-success text-[11px]">+ {formatValue(change.after)}</Text>
        </View>
    )
}

function RedactedLabel({ isVisible }: { isVisible: boolean }) {
    if (!isVisible) return null
    return <Text className="text-muted-foreground text-[11px] italic">[redacted]</Text>
}

function formatResourceType(resourceType: string): string {
    return resourceType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function formatValue(val: unknown): string {
    if (val === null || val === undefined) return '(empty)'
    if (typeof val === 'object') return JSON.stringify(val)
    return String(val)
}

function formatRelativeTime(dateStr: string): string {
    const date = new Date(dateStr.replace(' ', 'T'))
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMin = Math.floor(diffMs / 60000)

    if (diffMin < 1) return 'just now'
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr}h ago`
    const diffDay = Math.floor(diffHr / 24)
    if (diffDay < 30) return `${diffDay}d ago`
    return date.toLocaleDateString()
}
