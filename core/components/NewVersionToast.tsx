import { useVersionStore } from '@tinycld/core/lib/stores/version-store'
import { Platform, Pressable, Text, View } from 'react-native'

// NewVersionToast renders a small floating "click to refresh" pill in the
// bottom-right corner when the version-check hook has detected a deployed
// release id different from the one this client booted on. Web-only —
// native app updates are handled by Expo's OTA flow.
export function NewVersionToast() {
    const newVersionAvailable = useVersionStore(s => s.newVersionAvailable)

    if (Platform.OS !== 'web' || !newVersionAvailable) return null

    const onRefresh = () => {
        if (typeof window !== 'undefined') {
            window.location.reload()
        }
    }

    return (
        <View
            // position: 'fixed' is web-only; safe under the Platform.OS check.
            style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 50 } as object}
            className="rounded-lg bg-accent px-4 py-3 shadow-lg"
        >
            <Pressable onPress={onRefresh} accessibilityRole="button">
                <Text className="text-sm font-medium text-accent-foreground">
                    New version available — click to refresh
                </Text>
            </Pressable>
        </View>
    )
}
