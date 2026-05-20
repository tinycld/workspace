import { isReviewBuild } from '@tinycld/core/lib/build-mode'
import { getCoreConfigOptional } from '@tinycld/core/lib/core-config'
import { Pressable, Text, View } from 'react-native'

const FALLBACK_DEMO_EMAIL = 'appreview@tinycld.org'

interface ReviewModeHintsProps {
    onPrefill: (email: string, password: string) => void
}

export function ReviewModeHints({ onPrefill }: ReviewModeHintsProps) {
    if (!isReviewBuild()) return null
    const config = getCoreConfigOptional()
    const demoEmail = config?.demoEmail ?? FALLBACK_DEMO_EMAIL
    const demoPassword = config?.demoPassword ?? ''
    return (
        <View className="mt-2 border border-border rounded-lg p-3">
            <Text className="text-[11px] text-muted-foreground mb-2">App Review build</Text>
            <Pressable onPress={() => onPrefill(demoEmail, demoPassword)} className="py-1">
                <Text className="text-[13px] text-info underline">Fill demo credentials</Text>
            </Pressable>
        </View>
    )
}
