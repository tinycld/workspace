import { eq } from '@tanstack/db'
import { MemberAvatar } from '@tinycld/core/components/settings/members/MemberAvatar'
import {
    PendingBadge,
    RoleBadge,
    YouBadge,
} from '@tinycld/core/components/settings/members/MemberBadges'
import { MembersDrawer } from '@tinycld/core/components/settings/members/MembersDrawer'
import {
    type DrawerMode,
    type MemberRow,
    type OrgRole,
    ROLE_LABELS,
    ROLE_ORDER,
} from '@tinycld/core/components/settings/members/types'
import { useAuth } from '@tinycld/core/lib/auth'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useCurrentRole } from '@tinycld/core/lib/use-current-role'
import { useNavigateBack } from '@tinycld/core/lib/use-navigate-back'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { ArrowLeft, ChevronRight, Search, UserPlus, Users } from 'lucide-react-native'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'

export default function MembersSettings() {
    const orgHref = useOrgHref()
    const navigateBack = useNavigateBack(() => orgHref('settings'))
    const { isAdmin, isOwner } = useCurrentRole()
    const { user } = useAuth()
    const [userOrgCollection, usersCollection] = useStore('user_org', 'users')

    const fgColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted-foreground')
    const primaryFgColor = useThemeColor('primary-foreground')

    const { data: memberRows } = useOrgLiveQuery((query, { orgId }) =>
        query
            .from({ uo: userOrgCollection })
            .join({ u: usersCollection }, ({ uo, u }) => eq(uo.user, u.id))
            .where(({ uo }) => eq(uo.org, orgId))
            .select(({ uo, u }) => ({
                userOrgId: uo.id,
                userId: uo.user,
                // Cast: username is added by Phase A migration; pbSchema regenerates
                // after the next dev-server start picks it up.
                username: (u as unknown as { username: string }).username,
                name: u.name,
                email: u.email,
                role: uo.role,
                verified: u.verified,
                // Cast: is_demo is added by migration 1810000000; the pbSchema
                // regenerator picks it up after the next dev-server start.
                isDemo: (u as unknown as { is_demo: boolean }).is_demo,
            }))
    )

    const members: MemberRow[] = useMemo(
        () =>
            (memberRows ?? []).map(row => ({
                userOrgId: row.userOrgId,
                userId: row.userId,
                username: row.username ?? '',
                name: row.name ?? '',
                email: row.email ?? '',
                role: row.role as OrgRole,
                isPending: row.verified === false,
                isDemo: !!row.isDemo,
            })),
        [memberRows]
    )

    const [query, setQuery] = useState('')
    const [roleFilter, setRoleFilter] = useState<OrgRole | 'all'>('all')
    const [drawerMode, setDrawerMode] = useState<DrawerMode>({ kind: 'closed' })

    const { filtered, groups, counts, pendingCount } = useMemo(() => {
        const q = query.trim().toLowerCase()
        const matches = (m: MemberRow) =>
            !q ||
            m.name.toLowerCase().includes(q) ||
            m.username.toLowerCase().includes(q) ||
            m.email.toLowerCase().includes(q) ||
            m.role.toLowerCase().includes(q)

        const counts: Record<OrgRole | 'all', number> = {
            all: members.length,
            owner: 0,
            admin: 0,
            member: 0,
            guest: 0,
        }
        for (const m of members) counts[m.role] += 1
        const pendingCount = members.filter(m => m.isPending).length

        const filtered = members.filter(
            m => matches(m) && (roleFilter === 'all' || m.role === roleFilter)
        )

        const groups: Record<OrgRole, MemberRow[]> = {
            owner: [],
            admin: [],
            member: [],
            guest: [],
        }
        for (const m of filtered) groups[m.role].push(m)
        for (const role of ROLE_ORDER) {
            groups[role].sort((a, b) => {
                const aSelf = a.userId === user.id ? 0 : 1
                const bSelf = b.userId === user.id ? 0 : 1
                if (aSelf !== bSelf) return aSelf - bSelf
                const aName = (a.name || a.email).toLowerCase()
                const bName = (b.name || b.email).toLowerCase()
                return aName.localeCompare(bName)
            })
        }

        return { filtered, groups, counts, pendingCount }
    }, [members, query, roleFilter, user.id])

    if (!isAdmin) {
        return (
            <View className="flex-1 items-center justify-center p-5 bg-background">
                <View
                    className="items-center gap-3 rounded-xl bg-surface-secondary border border-border"
                    style={{
                        paddingVertical: 32,
                        paddingHorizontal: 24,
                    }}
                >
                    <Users size={28} color={mutedColor} />
                    <Text className="text-foreground" style={{ fontSize: 15, fontWeight: '600' }}>
                        Admin access required
                    </Text>
                    <Text
                        className="text-muted-foreground"
                        style={{ fontSize: 13, textAlign: 'center' }}
                    >
                        Only admins and owners can manage organization members.
                    </Text>
                </View>
            </View>
        )
    }

    const filterChips: Array<{ key: OrgRole | 'all'; label: string; count: number }> = [
        { key: 'all', label: 'All', count: counts.all },
        ...ROLE_ORDER.filter(r => counts[r] > 0).map(r => ({
            key: r,
            label: ROLE_LABELS[r],
            count: counts[r],
        })),
    ]

    return (
        <>
            <ScrollView contentContainerStyle={{ flexGrow: 1 }} className="bg-background">
                <View className="flex-1 gap-6 p-5" style={{ maxWidth: 820 }}>
                    <View className="flex-row items-center gap-3">
                        <Pressable
                            onPress={navigateBack}
                            hitSlop={12}
                            className="rounded-full"
                            style={{ padding: 6 }}
                        >
                            <ArrowLeft size={22} color={fgColor} />
                        </Pressable>
                        <View className="flex-1 gap-0.5">
                            <Text
                                className="text-muted-foreground"
                                style={{ fontSize: 11, letterSpacing: 0.6 }}
                            >
                                Settings
                            </Text>
                            <Text
                                className="text-foreground"
                                style={{ fontSize: 24, fontWeight: '800' }}
                            >
                                Members
                            </Text>
                        </View>
                        <Pressable
                            onPress={() => setDrawerMode({ kind: 'invite' })}
                            className="flex-row items-center gap-1.5 rounded-lg bg-primary"
                            style={{
                                paddingVertical: 9,
                                paddingHorizontal: 14,
                            }}
                        >
                            <UserPlus size={14} color={primaryFgColor} />
                            <Text
                                className="text-primary-foreground"
                                style={{
                                    fontSize: 13,
                                    fontWeight: '700',
                                }}
                            >
                                Invite
                            </Text>
                        </Pressable>
                    </View>

                    <View className="flex-row items-center gap-3 flex-wrap">
                        <StatChip label="Total" value={counts.all} tone="neutral" />
                        <StatChip
                            label="Pending"
                            value={pendingCount}
                            tone={pendingCount > 0 ? 'warn' : 'neutral'}
                            dim={pendingCount === 0}
                        />
                        {counts.owner > 0 && (
                            <StatChip label="Owners" value={counts.owner} tone="owner" />
                        )}
                    </View>

                    <View className="gap-3">
                        <View
                            className="flex-row items-center gap-2 rounded-xl border border-border bg-surface-secondary"
                            style={{
                                paddingHorizontal: 12,
                                paddingVertical: 8,
                            }}
                        >
                            <Search size={15} color={mutedColor} />
                            <TextInput
                                value={query}
                                onChangeText={setQuery}
                                placeholder="Search by name, email, or role"
                                placeholderTextColor={mutedColor}
                                autoCapitalize="none"
                                autoCorrect={false}
                                className="flex-1 text-foreground"
                                style={{
                                    fontSize: 14,
                                    paddingVertical: 2,
                                }}
                            />
                        </View>

                        <View className="flex-row gap-1.5 flex-wrap">
                            {filterChips.map(chip => (
                                <FilterChip
                                    key={chip.key}
                                    label={chip.label}
                                    count={chip.count}
                                    active={roleFilter === chip.key}
                                    onPress={() => setRoleFilter(chip.key)}
                                />
                            ))}
                        </View>
                    </View>

                    {filtered.length === 0 ? (
                        <EmptyState
                            query={query}
                            onClear={() => {
                                setQuery('')
                                setRoleFilter('all')
                            }}
                        />
                    ) : (
                        <View className="gap-4">
                            {ROLE_ORDER.map(role =>
                                groups[role].length > 0 ? (
                                    <MemberGroup
                                        key={role}
                                        role={role}
                                        rows={groups[role]}
                                        onSelect={m =>
                                            setDrawerMode({
                                                kind: 'view',
                                                userOrgId: m.userOrgId,
                                            })
                                        }
                                    />
                                ) : null
                            )}
                        </View>
                    )}
                </View>
            </ScrollView>

            <MembersDrawer
                mode={drawerMode}
                onClose={() => setDrawerMode({ kind: 'closed' })}
                members={members}
                isCurrentUserOwner={isOwner}
            />
        </>
    )
}

function MemberGroup({
    role,
    rows,
    onSelect,
}: {
    role: OrgRole
    rows: MemberRow[]
    onSelect: (member: MemberRow) => void
}) {
    const mutedColor = useThemeColor('muted-foreground')

    return (
        <View className="gap-2">
            <View className="flex-row items-center gap-2" style={{ paddingHorizontal: 2 }}>
                <Text
                    className="text-muted-foreground"
                    style={{
                        fontSize: 10.5,
                        fontWeight: '800',
                        textTransform: 'uppercase',
                        letterSpacing: 1,
                    }}
                >
                    {ROLE_LABELS[role]}
                    {rows.length === 1 ? '' : 's'}
                </Text>
                <View
                    style={{
                        paddingVertical: 1,
                        paddingHorizontal: 6,
                        borderRadius: 999,
                        backgroundColor: `${mutedColor}1F`,
                    }}
                >
                    <Text
                        className="text-muted-foreground"
                        style={{ fontSize: 10.5, fontWeight: '700' }}
                    >
                        {rows.length}
                    </Text>
                </View>
            </View>

            <View className="rounded-xl overflow-hidden bg-surface-secondary border border-border">
                {rows.map((member, idx) => (
                    <MemberRowItem
                        key={member.userOrgId}
                        member={member}
                        isFirst={idx === 0}
                        onPress={() => onSelect(member)}
                    />
                ))}
            </View>
        </View>
    )
}

function MemberRowItem({
    member,
    isFirst,
    onPress,
}: {
    member: MemberRow
    isFirst: boolean
    onPress: () => void
}) {
    const { user } = useAuth()
    const mutedColor = useThemeColor('muted-foreground')

    const isSelf = member.userId === user.id
    const displayName = member.name || member.username || member.email

    return (
        <Pressable
            onPress={onPress}
            className="flex-row items-center gap-3 border-border"
            style={{
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderTopWidth: isFirst ? 0 : 1,
            }}
        >
            <MemberAvatar
                name={member.name}
                email={member.email}
                size={38}
                dimmed={member.isPending}
            />

            <View className="flex-1" style={{ minWidth: 0 }}>
                <View className="flex-row items-center gap-1.5" style={{ flexWrap: 'wrap' }}>
                    <Text
                        className="text-foreground"
                        style={{ fontSize: 14, fontWeight: '600' }}
                        numberOfLines={1}
                    >
                        {displayName}
                    </Text>
                    {isSelf && <YouBadge />}
                </View>
                <Text
                    className="text-muted-foreground"
                    style={{ fontSize: 12.5 }}
                    numberOfLines={1}
                >
                    @{member.username}
                    {member.email ? ` · ${member.email}` : ''}
                </Text>
            </View>

            <View className="flex-row items-center gap-1.5">
                {member.isPending && <PendingBadge />}
                <RoleBadge role={member.role} size="sm" />
            </View>

            <ChevronRight size={15} color={mutedColor} />
        </Pressable>
    )
}

function FilterChip({
    label,
    count,
    active,
    onPress,
}: {
    label: string
    count: number
    active: boolean
    onPress: () => void
}) {
    return (
        <Pressable
            onPress={onPress}
            className={`flex-row items-center gap-1.5 rounded-full border ${active ? 'border-foreground bg-foreground' : 'border-border bg-surface-secondary'}`}
            style={{
                paddingVertical: 5,
                paddingHorizontal: 11,
            }}
        >
            <Text
                className={active ? 'text-surface-secondary' : 'text-foreground'}
                style={{
                    fontSize: 12.5,
                    fontWeight: '600',
                }}
            >
                {label}
            </Text>
            <Text
                className={active ? 'text-surface-secondary' : 'text-muted-foreground'}
                style={{
                    fontSize: 11,
                    fontWeight: '700',
                }}
            >
                {count}
            </Text>
        </Pressable>
    )
}

function StatChip({
    label,
    value,
    tone,
    dim,
}: {
    label: string
    value: number
    tone: 'neutral' | 'warn' | 'owner'
    dim?: boolean
}) {
    const fgColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted-foreground')
    const borderColor = useThemeColor('border')

    const tones = {
        neutral: { fg: fgColor, accent: mutedColor, ring: borderColor },
        warn: { fg: '#b45309', accent: '#b45309', ring: 'rgba(180, 83, 9, 0.35)' },
        owner: { fg: '#7c3aed', accent: '#7c3aed', ring: 'rgba(124, 58, 237, 0.35)' },
    }[tone]

    return (
        <View
            className="flex-row items-baseline gap-1.5 rounded-lg"
            style={{
                paddingVertical: 6,
                paddingHorizontal: 11,
                borderWidth: 1,
                borderColor: tones.ring,
                opacity: dim ? 0.5 : 1,
            }}
        >
            <Text style={{ fontSize: 15, fontWeight: '800', color: tones.accent }}>{value}</Text>
            <Text
                style={{
                    fontSize: 11,
                    fontWeight: '600',
                    color: tones.fg,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                }}
            >
                {label}
            </Text>
        </View>
    )
}

function EmptyState({ query, onClear }: { query: string; onClear: () => void }) {
    const primaryColor = useThemeColor('primary')

    const isSearching = query.trim().length > 0

    return (
        <View
            className="items-center gap-3 rounded-xl bg-surface-secondary border border-border"
            style={{
                paddingVertical: 32,
                paddingHorizontal: 24,
                borderStyle: 'dashed',
            }}
        >
            <View
                className="items-center justify-center rounded-full"
                style={{
                    width: 44,
                    height: 44,
                    backgroundColor: `${primaryColor}14`,
                }}
            >
                <Users size={20} color={primaryColor} />
            </View>
            <Text className="text-foreground" style={{ fontSize: 14, fontWeight: '600' }}>
                {isSearching ? 'No members match that search' : 'No members yet'}
            </Text>
            <Text className="text-muted-foreground" style={{ fontSize: 12.5, textAlign: 'center' }}>
                {isSearching
                    ? 'Try a different name, email, or clear the filters.'
                    : 'Invite your first teammate to get started.'}
            </Text>
            {isSearching && (
                <Pressable onPress={onClear}>
                    <Text className="text-primary" style={{ fontSize: 12.5, fontWeight: '700' }}>
                        Clear filters
                    </Text>
                </Pressable>
            )}
        </View>
    )
}
