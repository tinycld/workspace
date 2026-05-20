import { NotificationBell } from '@tinycld/core/components/NotificationBell'
import { OrgLogo } from '@tinycld/core/components/OrgLogo'
import { ImportIndicator } from '@tinycld/core/components/workspace/ImportIndicator'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useWorkspaceStore } from '@tinycld/core/lib/stores/workspace-store'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useOrgInfo } from '@tinycld/core/lib/use-org-info'
import { useSortedPackages } from '@tinycld/core/lib/use-sorted-packages'
import { Link } from 'expo-router'
import { Building2, HelpCircle, type LucideIcon, Settings } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { getIcon } from './package-icon-map'
import { UserMenu } from './UserMenu'

export function PackageRail() {
    const railBg = useThemeColor('rail-background')
    const railText = useThemeColor('rail-text')
    const railActive = useThemeColor('rail-active-text')
    const indicatorColor = useThemeColor('active-indicator')
    const sorted = useSortedPackages()
    const activePkgSlug = useWorkspaceStore(s => s.activePkgSlug)
    const orgHref = useOrgHref()
    const { org } = useOrgInfo()

    return (
        <View
            className="w-16 justify-between items-center py-3"
            style={{ backgroundColor: railBg }}
        >
            <View className="items-center gap-1">
                <Link href={orgHref('')} asChild>
                    <Pressable
                        testID="nav-home"
                        className="w-11 h-11 rounded-xl justify-center items-center"
                        accessibilityLabel="Organization home"
                    >
                        <OrgLogo
                            org={org}
                            size={32}
                            fallback={<Building2 size={24} color={railText} />}
                        />
                    </Pressable>
                </Link>

                <View className="w-7 h-px opacity-20 my-2" style={{ backgroundColor: railText }} />

                {sorted.map(pkg => {
                    const Icon = getIcon(pkg.nav?.icon ?? '')
                    const isActive = activePkgSlug === pkg.slug
                    return (
                        <PackageRailItem
                            key={pkg.slug}
                            slug={pkg.slug}
                            label={pkg.nav?.label ?? ''}
                            Icon={Icon}
                            isActive={isActive}
                            activeColor={indicatorColor}
                            textColor={isActive ? railActive : railText}
                        />
                    )
                })}
            </View>

            <View className="items-center gap-2">
                <ImportIndicator />
                <NotificationBell color={railText} />

                <Link href={orgHref('help')} asChild>
                    <Pressable
                        testID="nav-help"
                        className="w-11 h-11 rounded-xl justify-center items-center"
                        accessibilityLabel="Help"
                    >
                        <HelpCircle size={22} color={railText} />
                    </Pressable>
                </Link>

                <Link href={orgHref('settings')} asChild>
                    <Pressable
                        testID="nav-settings"
                        className="w-11 h-11 rounded-xl justify-center items-center"
                        accessibilityLabel="Settings"
                    >
                        <Settings size={22} color={railText} />
                    </Pressable>
                </Link>

                <UserMenu />
            </View>
        </View>
    )
}

function PackageRailItem({
    slug,
    label,
    Icon,
    isActive,
    activeColor,
    textColor,
}: {
    slug: string
    label: string
    Icon: LucideIcon
    isActive: boolean
    activeColor: string
    textColor: string
}) {
    const orgHref = useOrgHref()

    return (
        <View className="relative w-11 h-11 items-center justify-center">
            {isActive && (
                <View
                    className="absolute w-1 h-5 rounded-sm"
                    style={{ backgroundColor: activeColor, left: -10 }}
                />
            )}
            <Link href={orgHref(slug as never)} asChild>
                <Pressable
                    testID={`nav-${slug}`}
                    className="w-11 h-11 rounded-xl justify-center items-center"
                    style={isActive ? { backgroundColor: `${activeColor}22` } : undefined}
                    accessibilityLabel={label}
                >
                    <Icon size={22} color={textColor} />
                </Pressable>
            </Link>
        </View>
    )
}
