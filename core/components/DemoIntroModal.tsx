import { DemoLeadForm, type DemoLeadFormHandle } from '@tinycld/core/components/DemoLeadForm'
import { FirstRunModal } from '@tinycld/core/components/FirstRunModal'
import { useAuth } from '@tinycld/core/lib/auth'
import { Sparkles } from 'lucide-react-native'
import { useRef } from 'react'

/**
 * One-shot orientation modal for users entering via /api/demo/start. Renders
 * once per device (tracked via FirstRunModal's AsyncStorage marker) and only
 * for the singleton demo identity (user.isDemo).
 *
 * Pairs with the always-on DemoBanner: the modal asks for an email + reason
 * on first arrival; the banner reminds users they're in demo mode and
 * exposes a "Tell us about you" link that stays available afterward.
 *
 * Mounted from app/a/[orgSlug]/_layout.tsx so it appears on the first demo
 * screen regardless of which package the user lands in (mail, calendar, etc.).
 */
export function DemoIntroModal() {
    const { user, isLoggedIn, isInitializing } = useAuth({ throwIfAnon: false })
    const formRef = useRef<DemoLeadFormHandle>(null)

    const enabled = !isInitializing && isLoggedIn && !!user?.isDemo

    const handlePrimary = (): boolean => {
        return formRef.current?.submit() ?? false
    }

    return (
        <FirstRunModal
            storageKey="demoIntro"
            enabled={enabled}
            icon={Sparkles}
            accentToken="warning"
            title="You're in the demo workspace"
            intro="Poke around freely — this is shared, sandboxed, and resets nightly. If you'd like us to follow up, drop your email."
            primaryLabel="Submit and explore"
            onPrimary={handlePrimary}
            secondaryLabel="Skip for now"
        >
            <DemoLeadForm ref={formRef} source="intro_modal" />
        </FirstRunModal>
    )
}
