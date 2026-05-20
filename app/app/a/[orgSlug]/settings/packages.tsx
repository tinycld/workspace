import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { getIcon } from '@tinycld/core/components/workspace/package-icon-map'
import { captureException } from '@tinycld/core/lib/errors'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useCurrentRole } from '@tinycld/core/lib/use-current-role'
import { useOrgInfo } from '@tinycld/core/lib/use-org-info'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { Divider } from '@tinycld/core/ui/divider'
import { Switch } from '@tinycld/core/ui/switch'
import { ScrollView, Text, View } from 'react-native'

export default function OrgPackageSettings() {
    const { isAdmin } = useCurrentRole()

    if (!isAdmin) {
        return (
            <View className="flex-1 p-5 items-center justify-center bg-background">
                <Text className="text-muted-foreground text-base">
                    Only admins can manage packages.
                </Text>
            </View>
        )
    }

    return (
        <ScrollView className="flex-1 bg-background" contentContainerStyle={{ flexGrow: 1 }}>
            <View className="p-5 max-w-[600px] w-full gap-4">
                <Text className="text-foreground text-[22px] font-bold">Packages</Text>
                <Text className="text-muted-foreground text-sm">
                    Enable or disable packages for this organization. Disabled packages will be
                    hidden from all members.
                </Text>
                <PackageToggleList />
            </View>
        </ScrollView>
    )
}

function PackageToggleList() {
    const { orgId } = useOrgInfo()
    const [pkgRegistryCollection] = useStore('pkg_registry')
    const [orgPkgEnabledCollection] = useStore('org_pkg_enabled')

    // Get all active packages from registry
    const { data: bundledPackages } = useLiveQuery(
        query =>
            query
                .from({ pkg_registry: pkgRegistryCollection })
                .where(({ pkg_registry }) => eq(pkg_registry.status, 'bundled')),
        []
    )

    const { data: installedPackages } = useLiveQuery(
        query =>
            query
                .from({ pkg_registry: pkgRegistryCollection })
                .where(({ pkg_registry }) => eq(pkg_registry.status, 'installed')),
        []
    )

    // Get org-level toggles
    const { data: orgToggles } = useOrgLiveQuery(
        (query, { orgId: oid }) =>
            query
                .from({ org_pkg_enabled: orgPkgEnabledCollection })
                .where(({ org_pkg_enabled }) => eq(org_pkg_enabled.org, oid)),
        []
    )

    const allPackages = [...(bundledPackages ?? []), ...(installedPackages ?? [])].sort(
        (a, b) => (a.nav_order ?? 0) - (b.nav_order ?? 0)
    )

    if (allPackages.length === 0) {
        return (
            <View className="p-5 items-center rounded-xl border border-border bg-surface-secondary">
                <Text className="text-muted-foreground text-sm">No packages available.</Text>
            </View>
        )
    }

    const toggleMap = new Map(
        (orgToggles ?? []).map(t => [t.pkg, { id: t.id, enabled: t.enabled }])
    )

    return (
        <View className="rounded-xl border border-border overflow-hidden bg-surface-secondary">
            {allPackages.map((pkg, i) => (
                <View key={pkg.id}>
                    {i > 0 && <Divider />}
                    <PackageToggleRow pkg={pkg} orgId={orgId} toggle={toggleMap.get(pkg.slug)} />
                </View>
            ))}
        </View>
    )
}

function PackageToggleRow({
    pkg,
    orgId,
    toggle,
}: {
    pkg: { id: string; name: string; slug: string; icon: string; description: string }
    orgId: string
    toggle?: { id: string; enabled: boolean }
}) {
    const fgColor = useThemeColor('foreground')
    const [orgPkgEnabledCollection] = useStore('org_pkg_enabled')

    const isEnabled = toggle ? toggle.enabled : true

    const upsertToggle = useMutation({
        mutationFn: mutation(function* ({ enabled }: { enabled: boolean }) {
            if (toggle) {
                yield orgPkgEnabledCollection.update(toggle.id, draft => {
                    draft.enabled = enabled
                })
            } else {
                yield orgPkgEnabledCollection.insert({
                    id: crypto.randomUUID().replace(/-/g, '').slice(0, 15),
                    org: orgId,
                    pkg: pkg.slug,
                    enabled,
                    created: '',
                    updated: '',
                })
            }
        }),
        onError: err => captureException('Failed to toggle package', err),
    })

    const Icon = getIcon(pkg.icon)

    return (
        <View className="flex-row items-center justify-between px-4 py-3">
            <View className="flex-row items-center gap-3 flex-1">
                <Icon size={20} color={fgColor} />
                <View className="flex-1">
                    <Text className="text-foreground text-[15px] font-medium">{pkg.name}</Text>
                    {pkg.description && (
                        <Text className="text-muted-foreground text-xs">{pkg.description}</Text>
                    )}
                </View>
            </View>
            <Switch
                value={isEnabled}
                onValueChange={enabled => upsertToggle.mutate({ enabled })}
                disabled={upsertToggle.isPending}
            />
        </View>
    )
}
