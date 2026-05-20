import { eq } from '@tanstack/db'
import { useQuery, useQueryClient, useMutation as useRawMutation } from '@tanstack/react-query'
import { OrgLogo } from '@tinycld/core/components/OrgLogo'
import { handleMutationErrorsWithForm } from '@tinycld/core/lib/errors'
import { formatBytes } from '@tinycld/core/lib/format-utils'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { pb, useStore } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useCurrentRole } from '@tinycld/core/lib/use-current-role'
import { useNavigateBack } from '@tinycld/core/lib/use-navigate-back'
import { useOrgInfo } from '@tinycld/core/lib/use-org-info'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { Divider } from '@tinycld/core/ui/divider'
import {
    FormErrorSummary,
    NumberInput,
    TextInput,
    useForm,
    z,
    zodResolver,
} from '@tinycld/core/ui/form'
import * as DocumentPicker from 'expo-document-picker'
import { ArrowLeft } from 'lucide-react-native'
import { newRecordId } from 'pbtsdb/core'
import { useState } from 'react'
import { Platform, Pressable, ScrollView, Text, View } from 'react-native'

const LOGO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp']
const LOGO_MAX_BYTES = 5 * 1024 * 1024

type PickedLogo = File | { uri: string; name: string; type: string; size?: number }

async function pickLogo(): Promise<PickedLogo | null> {
    if (Platform.OS === 'web') {
        return new Promise(resolve => {
            const input = document.createElement('input')
            input.type = 'file'
            input.accept = LOGO_MIME_TYPES.join(',')
            input.onchange = () => resolve(input.files?.[0] ?? null)
            input.click()
        })
    }
    const result = await DocumentPicker.getDocumentAsync({ type: LOGO_MIME_TYPES, multiple: false })
    if (result.canceled) return null
    const a = result.assets[0]
    return { uri: a.uri, name: a.name, type: a.mimeType ?? 'image/png', size: a.size }
}

function logoSize(picked: PickedLogo): number {
    return 'size' in picked && typeof picked.size === 'number' ? picked.size : 0
}

const orgSchema = z.object({
    name: z.string().min(1, 'Organization name is required'),
})

const storageLimitSchema = z.object({
    limitGb: z.number().min(0, 'Must be 0 or greater'),
})

function formatStorageBytes(bytes: number): string {
    return bytes === 0 ? '0 B' : formatBytes(bytes)
}

export default function OrganizationSettings() {
    const orgHref = useOrgHref()
    const navigateBack = useNavigateBack(() => orgHref('settings'))
    const { isAdmin } = useCurrentRole()
    const { orgId } = useOrgInfo()
    const [orgsCollection] = useStore('orgs')

    const fgColor = useThemeColor('foreground')

    const { data: orgs } = useOrgLiveQuery((query, { orgId }) =>
        query.from({ orgs: orgsCollection }).where(({ orgs }) => eq(orgs.id, orgId))
    )
    const org = orgs?.[0]

    const {
        control,
        handleSubmit,
        setError,
        getValues,
        formState: { errors, isSubmitted, isDirty },
    } = useForm({
        mode: 'onChange',
        resolver: zodResolver(orgSchema),
        values: { name: org?.name ?? '' },
    })

    const updateOrg = useMutation({
        mutationFn: mutation(function* (data: z.infer<typeof orgSchema>) {
            if (!orgId) throw new Error('No organization context')
            yield orgsCollection.update(orgId, draft => {
                draft.name = data.name.trim()
            })
        }),
        onSuccess: navigateBack,
        onError: handleMutationErrorsWithForm({ setError, getValues }),
    })

    const onSubmit = handleSubmit(data => updateOrg.mutate(data))
    const canSubmit = !updateOrg.isPending && isDirty && !!orgId

    if (!isAdmin) {
        return (
            <View className="flex-1 p-5 items-center justify-center bg-background">
                <Text className="text-muted-foreground" style={{ fontSize: 16 }}>
                    Only admins can manage organization settings.
                </Text>
            </View>
        )
    }

    return (
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} className="bg-background">
            <View className="flex-1 p-5 max-w-[600px]">
                <View className="flex-row justify-between items-center mb-5">
                    <View className="flex-row gap-3 items-center">
                        <Pressable onPress={navigateBack}>
                            <ArrowLeft size={24} color={fgColor} />
                        </Pressable>
                        <Text
                            className="text-foreground"
                            style={{ fontSize: 22, fontWeight: 'bold' }}
                        >
                            Organization
                        </Text>
                    </View>
                    <Pressable
                        onPress={onSubmit}
                        disabled={!canSubmit}
                        className={`px-4 py-2 rounded-lg self-start bg-primary ${canSubmit ? 'opacity-100' : 'opacity-50'}`}
                    >
                        <Text className="text-primary-foreground" style={{ fontWeight: '600' }}>
                            {updateOrg.isPending ? 'Saving...' : 'Save'}
                        </Text>
                    </Pressable>
                </View>

                <FormErrorSummary errors={errors} isEnabled={isSubmitted} />

                <View className="gap-4">
                    <TextInput control={control} name="name" label="Organization Name" />

                    <View className="gap-1">
                        <Text className="text-primary" style={{ fontSize: 13 }}>
                            Slug
                        </Text>
                        <Text className="text-muted-foreground" style={{ fontSize: 16 }}>
                            {org?.slug ?? '\u2014'}
                        </Text>
                    </View>
                </View>

                <Divider className="my-5" />

                <LogoSection org={org ?? null} />

                <Divider className="my-5" />

                <StorageSection orgId={orgId} />
            </View>
        </ScrollView>
    )
}

function StorageSection({ orgId }: { orgId: string }) {
    const queryClient = useQueryClient()
    const [settingsCollection] = useStore('settings')
    const [showBreakdown, setShowBreakdown] = useState(false)

    const dangerColor = useThemeColor('danger')
    const warningColor = useThemeColor('warning')
    const successColor = useThemeColor('success')

    const { data: storageInfo, isLoading } = useQuery({
        queryKey: ['storage-usage', orgId],
        queryFn: () =>
            pb.send('/api/drive/storage-usage', {
                query: { org: orgId, breakdown: 'users' },
            }),
        enabled: !!orgId,
    })

    const { data: settings } = useOrgLiveQuery((query, { orgId }) =>
        query
            .from({ settings: settingsCollection })
            .where(({ settings }) => eq(settings.org, orgId))
    )

    const existingSetting = settings?.find(s => s.app === 'core' && s.key === 'storage_limit_bytes')

    const currentLimitGb = storageInfo?.has_limit
        ? storageInfo.limit_bytes / (1024 * 1024 * 1024)
        : 0

    const {
        control: limitControl,
        handleSubmit: handleLimitSubmit,
        setError: setLimitError,
        getValues: getLimitValues,
        formState: { errors: limitErrors, isSubmitted: isLimitSubmitted, isDirty: isLimitDirty },
    } = useForm({
        mode: 'onChange',
        resolver: zodResolver(storageLimitSchema),
        values: { limitGb: currentLimitGb },
    })

    const saveLimit = useMutation({
        mutationFn: mutation(function* (data: z.infer<typeof storageLimitSchema>) {
            const valueBytes = Math.round(data.limitGb * 1024 * 1024 * 1024)
            if (existingSetting) {
                yield settingsCollection.update(existingSetting.id, draft => {
                    draft.value = valueBytes
                })
            } else {
                yield settingsCollection.insert({
                    id: newRecordId(),
                    app: 'core',
                    key: 'storage_limit_bytes',
                    value: valueBytes,
                    org: orgId,
                })
            }
        }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['storage-usage', orgId] })
        },
        onError: handleMutationErrorsWithForm({
            setError: setLimitError,
            getValues: getLimitValues,
        }),
    })

    const onSaveLimit = handleLimitSubmit(data => saveLimit.mutate(data))
    const canSaveLimit = !saveLimit.isPending && isLimitDirty

    if (isLoading) {
        return (
            <View className="gap-3">
                <Text className="text-foreground" style={{ fontSize: 18, fontWeight: 'bold' }}>
                    Storage
                </Text>
                <Text className="text-muted-foreground" style={{ fontSize: 13 }}>
                    Loading...
                </Text>
            </View>
        )
    }

    const userUsed = storageInfo?.user_used_bytes ?? 0
    const limitBytes = storageInfo?.limit_bytes ?? 0
    const hasLimit = storageInfo?.has_limit ?? false
    const usagePercent =
        hasLimit && limitBytes > 0 ? Math.min((userUsed / limitBytes) * 100, 100) : 0
    const orgDriveBytes = storageInfo?.org_drive_bytes ?? 0
    const orgMailBytes = storageInfo?.org_mail_bytes ?? 0
    const users = storageInfo?.users as
        | { user_name: string; user_email: string; drive_used: number }[]
        | undefined

    const barColor =
        usagePercent > 90 ? dangerColor : usagePercent > 70 ? warningColor : successColor

    return (
        <View className="gap-4">
            <Text className="text-foreground" style={{ fontSize: 18, fontWeight: 'bold' }}>
                Storage
            </Text>

            <View className="gap-2">
                <Text className="text-primary" style={{ fontSize: 13 }}>
                    Your Usage
                </Text>
                <View className="flex-row justify-between items-center">
                    <Text className="text-foreground" style={{ fontSize: 15 }}>
                        {formatStorageBytes(userUsed)}
                        {hasLimit ? ` of ${formatStorageBytes(limitBytes)}` : ''}
                    </Text>
                    {hasLimit && (
                        <Text
                            className={usagePercent > 90 ? 'text-danger' : 'text-muted-foreground'}
                            style={{ fontSize: 13 }}
                        >
                            {usagePercent.toFixed(1)}%
                        </Text>
                    )}
                </View>
                {hasLimit && (
                    <View className="h-2 rounded overflow-hidden bg-surface-secondary">
                        <View
                            className="h-full rounded"
                            style={{
                                width: `${usagePercent}%`,
                                backgroundColor: barColor,
                            }}
                        />
                    </View>
                )}
            </View>

            <View className="gap-2">
                <Text className="text-primary" style={{ fontSize: 13 }}>
                    Organization Total
                </Text>
                <View className="flex-row gap-4">
                    <View>
                        <Text className="text-muted-foreground" style={{ fontSize: 13 }}>
                            Drive
                        </Text>
                        <Text className="text-foreground" style={{ fontSize: 15 }}>
                            {formatStorageBytes(orgDriveBytes)}
                        </Text>
                    </View>
                    <View>
                        <Text className="text-muted-foreground" style={{ fontSize: 13 }}>
                            Mail
                        </Text>
                        <Text className="text-foreground" style={{ fontSize: 15 }}>
                            {formatStorageBytes(orgMailBytes)}
                        </Text>
                    </View>
                </View>
            </View>

            <Divider />

            <View className="gap-3">
                <Text className="text-foreground" style={{ fontSize: 15, fontWeight: '600' }}>
                    Per-User Storage Limit
                </Text>
                <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
                    Set to 0 for unlimited storage. Applies to drive uploads only.
                </Text>

                <FormErrorSummary errors={limitErrors} isEnabled={isLimitSubmitted} />

                <View className="flex-row gap-3 items-end">
                    <View className="flex-1">
                        <NumberInput control={limitControl} name="limitGb" label="Limit (GB)" />
                    </View>
                    <Pressable
                        onPress={onSaveLimit}
                        disabled={!canSaveLimit}
                        className={`px-4 py-2 rounded-lg self-start bg-primary ${canSaveLimit ? 'opacity-100' : 'opacity-50'}`}
                    >
                        <Text className="text-primary-foreground" style={{ fontWeight: '600' }}>
                            {saveLimit.isPending ? 'Saving...' : 'Save Limit'}
                        </Text>
                    </Pressable>
                </View>
            </View>

            {users && users.length > 0 && (
                <>
                    <Divider />
                    <View className="gap-3">
                        <Pressable onPress={() => setShowBreakdown(v => !v)}>
                            <Text
                                className="text-foreground"
                                style={{ fontSize: 15, fontWeight: '600' }}
                            >
                                Per-User Breakdown {showBreakdown ? '\u25BE' : '\u25B8'}
                            </Text>
                        </Pressable>
                        <UserBreakdownTable
                            users={users}
                            limitBytes={limitBytes}
                            isVisible={showBreakdown}
                        />
                    </View>
                </>
            )}
        </View>
    )
}

function UserBreakdownTable({
    users,
    limitBytes,
    isVisible,
}: {
    users: { user_name: string; user_email: string; drive_used: number }[]
    limitBytes: number
    isVisible: boolean
}) {
    if (!isVisible) return null

    return (
        <View className="gap-2">
            {users.map(user => {
                const percent =
                    limitBytes > 0 ? Math.min((user.drive_used / limitBytes) * 100, 100) : 0
                return (
                    <View
                        key={user.user_email}
                        className="flex-row justify-between items-center py-1"
                    >
                        <View className="flex-1">
                            <Text className="text-foreground" style={{ fontSize: 13 }}>
                                {user.user_name || user.user_email}
                            </Text>
                            {user.user_name && (
                                <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
                                    {user.user_email}
                                </Text>
                            )}
                        </View>
                        <Text
                            className={percent > 90 ? 'text-danger' : 'text-muted-foreground'}
                            style={{ fontSize: 13 }}
                        >
                            {formatStorageBytes(user.drive_used)}
                        </Text>
                    </View>
                )
            })}
        </View>
    )
}

function LogoSection({ org }: { org: { id: string; name: string; logo?: string } | null }) {
    const [error, setError] = useState<string | null>(null)

    const upload = useRawMutation({
        mutationFn: async () => {
            if (!org?.id) throw new Error('No organization context')
            const picked = await pickLogo()
            if (!picked) return
            const size = logoSize(picked)
            if (size > LOGO_MAX_BYTES) {
                throw new Error(`Logo must be 5 MB or smaller (got ${formatBytes(size)}).`)
            }
            const fd = new FormData()
            fd.append('logo', picked as unknown as Blob)
            await pb.collection('orgs').update(org.id, fd)
        },
        onError: (err: Error) => setError(err.message),
        onSuccess: () => setError(null),
    })

    const remove = useRawMutation({
        mutationFn: async () => {
            if (!org?.id) throw new Error('No organization context')
            await pb.collection('orgs').update(org.id, { logo: null })
        },
        onError: (err: Error) => setError(err.message),
        onSuccess: () => setError(null),
    })

    const hasLogo = !!org?.logo

    return (
        <View className="gap-3">
            <Text className="text-foreground" style={{ fontSize: 18, fontWeight: 'bold' }}>
                Logo
            </Text>
            <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
                Up to 5 MB. PNG, JPEG, SVG, or WEBP.
            </Text>

            <View className="flex-row items-center gap-4">
                <View
                    className="border border-border"
                    style={{
                        width: 96,
                        height: 96,
                        borderRadius: 48,
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                    }}
                >
                    <OrgLogo org={org} size={96} />
                </View>

                <View className="flex-row gap-2">
                    <Pressable
                        onPress={() => upload.mutate()}
                        disabled={upload.isPending}
                        className={`px-4 py-2 rounded-lg bg-primary ${upload.isPending ? 'opacity-50' : ''}`}
                    >
                        <Text className="text-primary-foreground" style={{ fontWeight: '600' }}>
                            {upload.isPending ? 'Uploading…' : hasLogo ? 'Replace' : 'Upload'}
                        </Text>
                    </Pressable>
                    {hasLogo ? (
                        <Pressable
                            onPress={() => remove.mutate()}
                            disabled={remove.isPending}
                            className={`px-4 py-2 rounded-lg border border-border ${remove.isPending ? 'opacity-50' : ''}`}
                        >
                            <Text className="text-foreground" style={{ fontWeight: '600' }}>
                                {remove.isPending ? 'Removing…' : 'Remove'}
                            </Text>
                        </Pressable>
                    ) : null}
                </View>
            </View>

            {error ? (
                <Text className="text-danger" style={{ fontSize: 13 }}>
                    {error}
                </Text>
            ) : null}
        </View>
    )
}
