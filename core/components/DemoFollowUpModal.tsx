import { DemoLeadForm, type DemoLeadFormHandle } from '@tinycld/core/components/DemoLeadForm'
import { useAuth } from '@tinycld/core/lib/auth'
import { useDemoLeadStore } from '@tinycld/core/lib/stores/demo-lead-store'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { MessageCircle } from 'lucide-react-native'
import { useRef } from 'react'
import { Pressable, Text, View } from 'react-native'

/**
 * Banner-triggered demo-lead form. Opens when the user taps the demo banner's
 * "Tell us about you" link; closes on submit or cancel. The link stays
 * available afterward so users can send updates or correct their info.
 *
 * Renders nothing for non-demo users — the demo banner is the only place
 * that calls setFollowUpOpen(true).
 *
 * Mounted alongside DemoIntroModal in app/a/[orgSlug]/_layout.tsx.
 */
export function DemoFollowUpModal() {
    const { user, isLoggedIn } = useAuth({ throwIfAnon: false })
    const isOpen = useDemoLeadStore(s => s.isFollowUpOpen)
    const setFollowUpOpen = useDemoLeadStore(s => s.setFollowUpOpen)
    const setSubmitted = useDemoLeadStore(s => s.setSubmitted)

    const formRef = useRef<DemoLeadFormHandle>(null)
    const backdrop = useThemeColor('overlay-backdrop')
    const accent = useThemeColor('primary')
    const accentFg = useThemeColor('primary-foreground')

    if (!isOpen || !isLoggedIn || !user?.isDemo) return null

    const handleSubmit = () => {
        const ok = formRef.current?.submit() ?? false
        if (ok) setSubmitted()
    }

    const handleCancel = () => {
        setFollowUpOpen(false)
    }

    return (
        <View
            className="absolute top-0 left-0 right-0 bottom-0 justify-center items-center z-[250] p-6"
            style={{ backgroundColor: backdrop }}
        >
            <View
                className="max-w-full border border-border bg-background rounded-[20px] overflow-hidden"
                style={{
                    width: 460,
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 12 },
                    shadowOpacity: 0.2,
                    shadowRadius: 32,
                    elevation: 12,
                }}
            >
                <View className="h-[3px]" style={{ backgroundColor: accent }} />
                <View className="p-7">
                    <View
                        className="w-11 h-11 rounded-xl items-center justify-center mb-[18px]"
                        style={{ backgroundColor: accent }}
                    >
                        <MessageCircle size={22} color={accentFg} />
                    </View>
                    <Text className="text-[22px] font-bold text-foreground mb-5">
                        Tell us about yourself
                    </Text>

                    <DemoLeadForm ref={formRef} source="banner_link" />

                    <View className="flex-row gap-2.5 justify-end mt-2">
                        <Pressable
                            onPress={handleCancel}
                            className="py-2.5 px-4 rounded-[10px]"
                            testID="demo-followup-cancel"
                        >
                            <Text className="text-sm font-semibold text-muted-foreground">
                                Cancel
                            </Text>
                        </Pressable>
                        <Pressable
                            onPress={handleSubmit}
                            className="py-2.5 px-[18px] rounded-[10px]"
                            style={{ backgroundColor: accent }}
                            testID="demo-followup-submit"
                        >
                            <Text className="text-sm font-bold" style={{ color: accentFg }}>
                                Send
                            </Text>
                        </Pressable>
                    </View>
                </View>
            </View>
        </View>
    )
}
