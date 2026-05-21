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
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router'
import { HelpCircle, Pencil, Settings } from 'lucide-react-native'
import { useMemo, useState } from 'react'
import { Pressable } from 'react-native'
import { MailboxSidebarSection } from './components/MailboxSidebarSection'
import { UnifiedInboxSection } from './components/UnifiedInboxSection'
import { composeEvents } from './hooks/composeEvents'
import { useLabels } from './hooks/useLabels'
import { useMailboxes } from './hooks/useMailboxes'
import { useMailboxFolderCounts } from './hooks/useMailboxFolderCounts'

interface MailSidebarProps {
    isCollapsed: boolean
}

function useActiveView() {
    const pathname = usePathname()
    const { folder, label, mailbox } = useGlobalSearchParams<{
        folder?: string
        label?: string
        mailbox?: string
    }>()
    if (pathname.includes('/mail/')) {
        return {
            folder: null,
            activeLabels: new Set<string>(),
            activeMailbox: mailbox ?? null,
            isDefaultView: false,
        }
    }
    const activeLabels = new Set(label ? label.split(',').filter(Boolean) : [])
    const isDefaultView = !folder && activeLabels.size === 0 && !mailbox
    return {
        folder: activeLabels.size > 0 ? null : (folder ?? 'inbox'),
        activeLabels,
        activeMailbox: mailbox ?? null,
        isDefaultView,
    }
}

const EMPTY_COUNTS = { inbox: 0, drafts: 0, sent: 0, starred: 0, trash: 0, spam: 0 }

export default function MailSidebar(_props: MailSidebarProps) {
    const router = useRouter()
    const mutedColor = useThemeColor('muted-foreground')
    const { folder: activeFolder, activeLabels, activeMailbox, isDefaultView } = useActiveView()
    const orgHref = useOrgHref()
    const [labelManagerOpen, setLabelManagerOpen] = useState(false)

    const { labels: orgLabels } = useLabels()
    const { personal, shared } = useMailboxes()
    const counts = useMailboxFolderCounts()

    const mailboxCount = (personal ? 1 : 0) + shared.length
    const showUnifiedInbox = mailboxCount >= 2
    const isUnifiedActive = activeFolder === 'all-inboxes' || (isDefaultView && showUnifiedInbox)
    const activeMailboxId = isUnifiedActive ? '' : (activeMailbox ?? personal?.id ?? '')

    const unifiedUnread = useMemo(() => {
        let total = 0
        for (const c of counts.values()) total += c.inbox
        return total
    }, [counts])

    const navigateTo = (mailboxId: string, folder: string) => {
        const params: Record<string, string> = {}
        if (mailboxId && mailboxId !== personal?.id) params.mailbox = mailboxId
        if (folder !== 'inbox') params.folder = folder
        // When "All Inboxes" is the default view at /mail, the personal inbox
        // click would otherwise collapse to bare /mail and resolve back to the
        // unified view. Pass an explicit folder=inbox to disambiguate.
        if (showUnifiedInbox && mailboxId === personal?.id && folder === 'inbox') {
            params.folder = 'inbox'
        }
        router.push(orgHref('mail', Object.keys(params).length ? params : undefined))
    }

    const navigateToUnified = () => {
        router.push(orgHref('mail', { folder: 'all-inboxes' }))
    }

    const toggleLabel = (labelId: string) => {
        const next = new Set(activeLabels)
        if (next.has(labelId)) next.delete(labelId)
        else next.add(labelId)
        if (next.size === 0) router.push(orgHref('mail'))
        else router.push(orgHref('mail', { label: Array.from(next).join(',') }))
    }

    const labelItems = orgLabels.map((label) => (
        <SidebarItem
            key={label.id}
            label={label.name}
            colorDot={label.color}
            isActive={activeLabels.has(label.id)}
            closesDrawer
            onPress={() => toggleLabel(label.id)}
        />
    ))

    return (
        <SidebarNav>
            <SidebarActionButton label="Compose" icon={Pencil} onPress={() => composeEvents.emit()} />

            {showUnifiedInbox && (
                <UnifiedInboxSection
                    isActive={isUnifiedActive}
                    unreadCount={unifiedUnread}
                    onPress={navigateToUnified}
                />
            )}

            {personal && (
                <MailboxSidebarSection
                    mailboxId={personal.id}
                    mailboxLabel="Personal"
                    defaultExpanded
                    counts={counts.get(personal.id) ?? EMPTY_COUNTS}
                    activeMailboxId={activeMailboxId}
                    activeFolder={activeFolder}
                    onNavigate={navigateTo}
                />
            )}

            {shared.map((mb) => (
                <MailboxSidebarSection
                    key={mb.id}
                    mailboxId={mb.id}
                    mailboxLabel={mb.display_name || mb.address}
                    defaultExpanded={false}
                    counts={counts.get(mb.id) ?? EMPTY_COUNTS}
                    activeMailboxId={activeMailboxId}
                    activeFolder={activeFolder}
                    onNavigate={navigateTo}
                />
            ))}

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
                onPress={() => openHelpPackage('mail')}
            />

            <LabelManagerDialog isVisible={labelManagerOpen} onClose={() => setLabelManagerOpen(false)} />
        </SidebarNav>
    )
}
