import { DemoBanner } from '@tinycld/core/components/DemoBanner'
import { NotificationDrawer } from '@tinycld/core/components/NotificationDrawer'
import { useWorkspaceStore } from '@tinycld/core/lib/stores/workspace-store'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Platform, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FrozenStack } from './FrozenStack'
import { MobileDrawer } from './MobileDrawer'
import { MobileTabBar } from './MobileTabBar'
import { MoreDrawer } from './MoreDrawer'
import { PackageProviderWrapper } from './PackageProviderWrapper'

export function MobileLayout({ isReady = true }: { isReady?: boolean }) {
    const isDrawerOpen = useWorkspaceStore(s => s.isDrawerOpen)
    const insets = useSafeAreaInsets()
    const bgColor = useThemeColor('background')

    return (
        <PackageProviderWrapper>
            <View
                className="flex-1"
                style={[
                    {
                        backgroundColor: bgColor,
                        paddingTop: insets.top,
                    },
                    Platform.OS === 'web' ? ({ height: '100vh' } as object) : undefined,
                ]}
            >
                <DemoBanner />
                <View className="flex-1 overflow-hidden">
                    <FrozenStack />
                    {isReady && <MoreDrawer />}
                    {isReady && <NotificationDrawer mobile />}
                </View>
                {isReady && <MobileTabBar />}
                {isReady && <MobileDrawer isVisible={isDrawerOpen} />}
            </View>
        </PackageProviderWrapper>
    )
}
