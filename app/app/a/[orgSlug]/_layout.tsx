import { DemoFollowUpModal } from '@tinycld/core/components/DemoFollowUpModal'
import { DemoIntroModal } from '@tinycld/core/components/DemoIntroModal'
import { HelpDrawer } from '@tinycld/core/components/help/HelpDrawer'
import { HelpSearchPalette } from '@tinycld/core/components/help/HelpSearchPalette'
import { NotifyContextSync } from '@tinycld/core/components/NotifyContextSync'
import { AuthGate } from '@tinycld/core/components/workspace/AuthGate'
import { ImportNotifier } from '@tinycld/core/components/workspace/ImportNotifier'
import { SkeletonLayout } from '@tinycld/core/components/workspace/SkeletonLayout'
import { WorkspaceLayout } from '@tinycld/core/components/workspace/WorkspaceLayout'
import { useAuth } from '@tinycld/core/lib/auth'
import { useHelpSearchShortcut } from '@tinycld/core/lib/help/use-help-search-shortcut'
import { useWorkspaceStore } from '@tinycld/core/lib/stores/workspace-store'
import { OrgSlugProvider } from '@tinycld/core/lib/use-org-slug'
import { useGlobalSearchParams, usePathname } from 'expo-router'
import { useEffect } from 'react'

export default function OrgLayout() {
    const { orgSlug = '' } = useGlobalSearchParams<{ orgSlug: string }>()

    return (
        <OrgSlugProvider slug={orgSlug}>
            <OrgLayoutInner />
        </OrgSlugProvider>
    )
}

function OrgLayoutInner() {
    const auth = useAuth({ throwIfAnon: false })
    const isReady = !auth.isInitializing && auth.isLoggedIn
    // Bind ⌘/ globally so the help palette is reachable from any
    // org-scoped screen — not just package detail screens. The hook
    // is a no-op on native.
    useHelpSearchShortcut()

    if (!isReady) {
        return (
            <>
                <SkeletonLayout />
                {!auth.isInitializing && !auth.isLoggedIn && <AuthGate />}
            </>
        )
    }

    return (
        <>
            <ActivePkgSync />
            <ImportNotifier />
            <NotifyContextSync />
            <WorkspaceLayout isReady={isReady} />
            <DemoIntroModal />
            <DemoFollowUpModal />
            <HelpDrawer />
            <HelpSearchPalette />
        </>
    )
}

function ActivePkgSync() {
    const pathname = usePathname()

    useEffect(() => {
        const match = pathname.match(/^\/a\/[^/]+\/([^/?]+)/)
        const slug = match?.[1] ?? null
        const nextSlug = slug === 'settings' || slug === 'help' ? null : slug

        const state = useWorkspaceStore.getState()
        if (state.isDrawerOpen) state.setDrawerOpen(false)
        if (state.activePkgSlug !== nextSlug) state.setActivePkgSlug(nextSlug)
    }, [pathname])

    return null
}
