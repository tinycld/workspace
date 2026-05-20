import { and, eq } from '@tanstack/db'
import { LabelManagerDialog } from '@tinycld/core/components/LabelManagerDialog'
import {
    SidebarActionButton,
    SidebarDivider,
    SidebarHeading,
    SidebarItem,
    SidebarNav,
} from '@tinycld/core/components/sidebar-primitives'
import { openHelpPackage } from '@tinycld/core/lib/help/open-help'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useLabels } from '@tinycld/core/ui/hooks/useLabels'
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router'
import { Building2, HelpCircle, Settings, Star, Trash2, Users } from 'lucide-react-native'
import { useMemo, useState } from 'react'
import { Pressable } from 'react-native'

interface ContactsSidebarProps {
    isCollapsed: boolean
}

export default function ContactsSidebar(_props: ContactsSidebarProps) {
    const router = useRouter()
    const pathname = usePathname()
    const orgHref = useOrgHref()
    const { filter, label: activeLabel } = useGlobalSearchParams<{
        filter?: string
        label?: string
    }>()
    const [labelManagerOpen, setLabelManagerOpen] = useState(false)
    const mutedColor = useThemeColor('muted-foreground')

    const [contactsCollection] = useStore('contacts')
    const [assignmentsCollection] = useStore('label_assignments')
    const { labels: orgLabels } = useLabels()

    const { data: allContactsRaw } = useOrgLiveQuery((query, { userOrgId }) =>
        query.from({ contacts: contactsCollection }).where(({ contacts }) => eq(contacts.owner, userOrgId))
    )

    const { data: contactAssignments } = useOrgLiveQuery((query, { userOrgId }) =>
        query
            .from({ label_assignments: assignmentsCollection })
            .where(({ label_assignments }) =>
                and(eq(label_assignments.collection, 'contacts'), eq(label_assignments.user_org, userOrgId))
            )
    )

    const { totalCount, favoriteCount, deletedCount } = useMemo(() => {
        let total = 0,
            favorites = 0,
            deleted = 0
        for (const c of allContactsRaw ?? []) {
            if (c.deleted_at) {
                deleted++
                continue
            }
            total++
            if (c.favorite) favorites++
        }
        return { totalCount: total, favoriteCount: favorites, deletedCount: deleted }
    }, [allContactsRaw])

    const labelCounts = useMemo(() => {
        const counts = new Map<string, number>()
        for (const a of contactAssignments ?? []) {
            counts.set(a.label, (counts.get(a.label) ?? 0) + 1)
        }
        return counts
    }, [contactAssignments])

    const isContactsActive =
        (pathname.endsWith('/contacts') || pathname.endsWith('/contacts/')) && !filter && !activeLabel

    const labelItems = orgLabels.map((label) => (
        <SidebarItem
            key={label.id}
            label={label.name}
            colorDot={label.color}
            badge={labelCounts.get(label.id) || undefined}
            isActive={activeLabel === label.id}
            closesDrawer
            onPress={() => router.push(orgHref('contacts', { label: label.id }))}
        />
    ))

    return (
        <SidebarNav>
            <SidebarActionButton label="+ Create contact" onPress={() => router.push(orgHref('contacts/new'))} />
            <SidebarItem
                label="Contacts"
                icon={Users}
                badge={totalCount}
                isActive={isContactsActive}
                closesDrawer
                onPress={() => router.push(orgHref('contacts'))}
            />
            <SidebarItem
                label="Favorites"
                icon={Star}
                badge={favoriteCount}
                isActive={filter === 'favorites'}
                closesDrawer
                onPress={() => router.push(orgHref('contacts', { filter: 'favorites' }))}
            />
            <SidebarItem
                label="Directory"
                icon={Building2}
                isActive={pathname.includes('/contacts/directory')}
                closesDrawer
                onPress={() => router.push(orgHref('contacts/directory'))}
            />
            <SidebarItem
                label="Deleted"
                icon={Trash2}
                badge={deletedCount || undefined}
                isActive={filter === 'deleted'}
                closesDrawer
                onPress={() => router.push(orgHref('contacts', { filter: 'deleted' }))}
            />

            <SidebarDivider />

            <SidebarHeading
                action={
                    <Pressable
                        onPress={() => setLabelManagerOpen(true)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <Settings size={14} color={mutedColor} />
                    </Pressable>
                }
            >
                Labels
            </SidebarHeading>

            {labelItems}

            <SidebarDivider />

            <SidebarItem
                label="Help"
                icon={HelpCircle}
                closesDrawer
                onPress={() => openHelpPackage('contacts')}
            />

            <LabelManagerDialog isVisible={labelManagerOpen} onClose={() => setLabelManagerOpen(false)} />
        </SidebarNav>
    )
}
