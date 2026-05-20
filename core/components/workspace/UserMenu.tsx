import { MenuActionItem } from '@tinycld/core/components/DropdownMenu'
import { OrgLogo } from '@tinycld/core/components/OrgLogo'
import { useAuth } from '@tinycld/core/lib/auth'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { getOrgHrefString, navigateToOrg } from '@tinycld/core/lib/org-url'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useOrgSlug } from '@tinycld/core/lib/use-org-slug'
import { Menu, Separator } from '@tinycld/core/ui/menu'
import { useRouter } from 'expo-router'
import { LogOut, Settings, User } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { useUserOrgs } from './useUserOrgs'

export function UserMenu() {
    const railActiveText = useThemeColor('rail-active-text')
    const { user, logout } = useAuth()
    const orgSlug = useOrgSlug()
    const orgHref = useOrgHref()
    const router = useRouter()
    const orgs = useUserOrgs()

    return (
        <Menu>
            <Menu.Trigger>
                <Pressable
                    className="size-8 rounded-full justify-center items-center"
                    style={{
                        backgroundColor: 'rgba(255,255,255,0.15)',
                    }}
                    accessibilityLabel="User menu"
                >
                    <User size={20} color={railActiveText} />
                </Pressable>
            </Menu.Trigger>
            <Menu.Portal>
                <Menu.Overlay />
                <Menu.Content presentation="popover" placement="top" align="start">
                    <View className="px-3 py-2">
                        <Text className="text-base font-bold text-foreground">{user.name}</Text>
                    </View>

                    <Separator />

                    <MenuActionItem
                        label="Settings"
                        icon={Settings}
                        onPress={() => router.push(orgHref('settings/personal'))}
                    />

                    <Separator />

                    <Menu.Label>Organizations</Menu.Label>

                    {orgs.map(org => (
                        <MenuActionItem
                            key={org.id}
                            label={org.name}
                            leading={<OrgLogo org={org} size={18} />}
                            isActive={org.slug === orgSlug}
                            href={getOrgHrefString(org.slug)}
                            onPress={() => navigateToOrg(org.slug)}
                        />
                    ))}

                    <Separator />

                    <MenuActionItem label="Sign out" icon={LogOut} onPress={logout} />
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
