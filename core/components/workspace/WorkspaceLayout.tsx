import { DemoBanner } from '@tinycld/core/components/DemoBanner'
import { NotificationDrawer } from '@tinycld/core/components/NotificationDrawer'
import { usePackage } from '@tinycld/core/lib/packages/use-packages'
import { useWorkspaceStore } from '@tinycld/core/lib/stores/workspace-store'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Platform, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FrozenStack } from './FrozenStack'
import { MobileLayout } from './MobileLayout'
import { PackageProviderWrapper } from './PackageProviderWrapper'
import { PackageRail } from './PackageRail'
import { PackageSidebar } from './PackageSidebar'
import { useBreakpoint } from './useBreakpoint'

const SIDEBAR_WIDTH = 260
const RAIL_WIDTH = 64
const TRANSITION = 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)'

export function WorkspaceLayout({ isReady = true }: { isReady?: boolean }) {
    const bgColor = useThemeColor('background')
    const overlayColor = useThemeColor('overlay-backdrop')
    const breakpoint = useBreakpoint()
    const isSidebarOpen = useWorkspaceStore(s => s.isSidebarOpen)
    const setSidebarOpen = useWorkspaceStore(s => s.setSidebarOpen)
    const activePkgSlug = useWorkspaceStore(s => s.activePkgSlug)
    const activePkg = usePackage(activePkgSlug ?? '')
    const insets = useSafeAreaInsets()

    if (breakpoint === 'mobile') return <MobileLayout isReady={isReady} />

    const isTablet = breakpoint === 'tablet'
    const hasSidebar = activePkg?.sidebar != null
    const showSidebarOverlay = isTablet && isSidebarOpen && hasSidebar

    return (
        <View
            className="flex-1"
            style={[
                {
                    backgroundColor: bgColor,
                    paddingTop: insets.top,
                    paddingLeft: insets.left,
                    paddingRight: insets.right,
                },
                Platform.OS === 'web' ? ({ height: '100vh' } as object) : undefined,
            ]}
        >
            <DemoBanner />
            <View className="flex-1 flex-row" style={{ minHeight: 0 }}>
                {isReady && <PackageRail />}

                {isReady && <NotificationDrawer />}

                <PackageProviderWrapper>
                    {isReady &&
                        hasSidebar &&
                        (isTablet ? (
                            <SidebarOverlay
                                isVisible={showSidebarOverlay}
                                overlayColor={overlayColor}
                                onDismiss={() => setSidebarOpen(false)}
                            />
                        ) : (
                            <PackageSidebar width={SIDEBAR_WIDTH} />
                        ))}

                    <View
                        className="flex-1"
                        style={{
                            backgroundColor: bgColor,
                            minHeight: 0,
                        }}
                    >
                        <FrozenStack />
                    </View>
                </PackageProviderWrapper>
            </View>
        </View>
    )
}

function SidebarOverlay({
    isVisible,
    overlayColor,
    onDismiss,
}: {
    isVisible: boolean
    overlayColor: string
    onDismiss: () => void
}) {
    return (
        <View
            className="absolute top-0 left-0 right-0 bottom-0 flex-row"
            style={{
                zIndex: 100,
            }}
            pointerEvents={isVisible ? 'auto' : 'none'}
        >
            <Pressable
                className="absolute top-0 right-0 bottom-0"
                style={
                    {
                        left: RAIL_WIDTH,
                        backgroundColor: overlayColor,
                        opacity: isVisible ? 1 : 0,
                        transition: TRANSITION,
                    } as object
                }
                onPress={onDismiss}
            />
            <View
                style={[
                    { marginLeft: RAIL_WIDTH, zIndex: 101, alignSelf: 'stretch' as const },
                    Platform.OS === 'web'
                        ? ({
                              transform: `translateX(${isVisible ? 0 : -SIDEBAR_WIDTH}px)`,
                              transition: TRANSITION,
                          } as object)
                        : undefined,
                ]}
            >
                <PackageSidebar width={SIDEBAR_WIDTH} />
            </View>
        </View>
    )
}
