import { packageSidebars } from '@tinycld/core/lib/packages/derive-components'
import { usePackage } from '@tinycld/core/lib/packages/use-packages'
import { useWorkspaceStore } from '@tinycld/core/lib/stores/workspace-store'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Suspense } from 'react'
import { Platform, View } from 'react-native'
import { SkeletonSidebar } from './SkeletonLayout'

interface PackageSidebarProps {
    width: number
}

export function PackageSidebar({ width }: PackageSidebarProps) {
    const activePkgSlug = useWorkspaceStore(s => s.activePkgSlug)
    const isSidebarOpen = useWorkspaceStore(s => s.isSidebarOpen)
    const pkg = usePackage(activePkgSlug ?? '')
    const sidebarBg = useThemeColor('sidebar-background')

    if (!pkg) return null

    const SidebarComponent = packageSidebars[pkg.slug]
    const targetWidth = isSidebarOpen ? width : 0

    return (
        <View
            className={`overflow-hidden border-border ${isSidebarOpen ? 'border-r' : ''}`}
            style={[
                { width: targetWidth, backgroundColor: sidebarBg },
                Platform.OS === 'web'
                    ? ({
                          transition:
                              'width 0.25s cubic-bezier(0.4, 0, 0.2, 1), border-right-width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                      } as object)
                    : undefined,
            ]}
        >
            <View style={{ width, flex: 1, minHeight: 0 }}>
                {SidebarComponent ? (
                    <Suspense fallback={<SkeletonSidebar width={width} />}>
                        <SidebarComponent isCollapsed={false} />
                    </Suspense>
                ) : null}
            </View>
        </View>
    )
}
