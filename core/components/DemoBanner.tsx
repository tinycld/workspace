import { useAuth } from '@tinycld/core/lib/auth'
import { hexToRgba } from '@tinycld/core/lib/color-utils'
import { useDemoLeadStore } from '@tinycld/core/lib/stores/demo-lead-store'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Info } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'

/**
 * Persistent ribbon shown to demo accounts so reviewers and prospects don't
 * confuse simulated sends with real ones. Outbound side effects (mail send,
 * invite/share emails, Expo push) are suppressed server-side; this banner is
 * the user-visible cue.
 *
 * Also hosts the deferred lead-capture entry point: a "Tell us about you"
 * link on the right side always opens DemoFollowUpModal — even after a
 * previous submit, so users can send updates or correct their info.
 *
 * Returns null for non-demo users.
 */
export function DemoBanner() {
    const { user, isLoggedIn } = useAuth({ throwIfAnon: false })
    const setFollowUpOpen = useDemoLeadStore(s => s.setFollowUpOpen)
    const warning = useThemeColor('warning')
    const primary = useThemeColor('primary')

    if (!isLoggedIn || !user?.isDemo) return null

    return (
        <View
            className="py-1.5 px-3 flex-row items-center gap-2 border-b flex-wrap"
            style={{
                backgroundColor: hexToRgba(warning, 0.18),
                borderBottomColor: hexToRgba(warning, 0.4),
            }}
        >
            <Info size={14} color={warning} />
            <Text className="text-xs font-semibold text-foreground">Demo Only:</Text>
            <Text className="text-xs text-muted-foreground">Sends are simulated</Text>
            <View className="flex-1" />
            <Pressable
                onPress={() => setFollowUpOpen(true)}
                testID="demo-banner-cta"
                accessibilityRole="link"
                accessibilityLabel="Tell us about yourself"
            >
                <Text className="text-xs font-semibold" style={{ color: primary }}>
                    Tell us about you →
                </Text>
            </Pressable>
        </View>
    )
}
