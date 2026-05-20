import { packageRegistry } from '@tinycld/app-generated/package-registry'
import { deriveUsername } from '@tinycld/core/lib/derive-username'
import { captureException } from '@tinycld/core/lib/errors'
import { pb as appPb } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Divider } from '@tinycld/core/ui/divider'
import { FormErrorSummary, TextInput, useForm, z, zodResolver } from '@tinycld/core/ui/form'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react-native'
import type PocketBase from 'pocketbase'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { PackageManager } from './PackageManager'

const mailInstalled = packageRegistry.some(p => p.slug === 'mail')

const setupSchema = z.object({
    orgName: z.string().min(3, 'Min 3 characters').max(45, 'Max 45 characters'),
    orgSlug: z
        .string()
        .min(3, 'Min 3 characters')
        .max(15, 'Max 15 characters')
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, numbers, and hyphens only'),
    ownerName: z.string().min(1, 'Name is required'),
    email: z.email(),
    password: z.string().min(8, 'Min 8 characters'),
    mailDomain: mailInstalled
        ? z
              .string()
              .min(3, 'Min 3 characters')
              .max(253, 'Max 253 characters')
              .regex(
                  /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/,
                  'Enter a valid domain (e.g. example.com)'
              )
        : z.string().optional(),
})

const editOrgSchema = z.object({
    name: z.string().min(3, 'Min 3 characters').max(45, 'Max 45 characters'),
    ownerName: z.string().min(1, 'Name is required'),
    ownerEmail: z.email(),
    ownerPassword: z.union([z.string().min(8, 'Min 8 characters'), z.literal('')]),
})

function deriveSlug(name: string) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 15)
}

interface OrgEntry {
    id: string
    name: string
    slug: string
    ownerEmail: string | null
    ownerId: string | null
    ownerName: string | null
    created: string
}

interface SetupDashboardProps {
    pb: PocketBase
    defaultTab?: SetupTab
}

type SetupTab = 'organizations' | 'packages'

export function SetupDashboard({ pb, defaultTab = 'packages' }: SetupDashboardProps) {
    const primaryBg = useThemeColor('primary')
    const mutedColor = useThemeColor('muted-foreground')
    const fgColor = useThemeColor('foreground')
    const [activeTab, setActiveTab] = useState<SetupTab>(defaultTab)

    return (
        <View className="w-full self-center p-5 gap-5" style={{ maxWidth: 640 }}>
            <View className="flex-row gap-4 mb-2 border-b border-border">
                <TabButton
                    label="Organizations"
                    isActive={activeTab === 'organizations'}
                    onPress={() => setActiveTab('organizations')}
                    activeColor={primaryBg}
                    inactiveColor={mutedColor}
                    textColor={fgColor}
                />
                <TabButton
                    label="Packages"
                    isActive={activeTab === 'packages'}
                    onPress={() => setActiveTab('packages')}
                    activeColor={primaryBg}
                    inactiveColor={mutedColor}
                    textColor={fgColor}
                />
            </View>
            <OrganizationsTab isVisible={activeTab === 'organizations'} pb={pb} />
            <PackagesTab isVisible={activeTab === 'packages'} pb={pb} />
        </View>
    )
}

function TabButton({
    label,
    isActive,
    onPress,
    activeColor,
    inactiveColor,
    textColor,
}: {
    label: string
    isActive: boolean
    onPress: () => void
    activeColor: string
    inactiveColor: string
    textColor: string
}) {
    return (
        <Pressable
            onPress={onPress}
            className="pb-2"
            style={{
                borderBottomWidth: 2,
                borderColor: isActive ? activeColor : 'transparent',
                marginBottom: -1,
            }}
        >
            <Text
                style={{
                    fontSize: 15,
                    fontWeight: isActive ? '600' : '400',
                    color: isActive ? textColor : inactiveColor,
                }}
            >
                {label}
            </Text>
        </Pressable>
    )
}

function PackagesTab({ isVisible, pb }: { isVisible: boolean; pb: PocketBase }) {
    if (!isVisible) return null
    return <PackageManager pb={pb} />
}

function OrganizationsTab({ isVisible, pb }: { isVisible: boolean; pb: PocketBase }) {
    const [orgs, setOrgs] = useState<OrgEntry[]>([])
    const [isLoadingOrgs, setIsLoadingOrgs] = useState(true)
    const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null)
    const [showCreateForm, setShowCreateForm] = useState(false)

    const fetchOrgs = useCallback(async () => {
        setIsLoadingOrgs(true)
        try {
            const orgRecords = await pb.collection('orgs').getFullList({ sort: '-created' })
            const entries: OrgEntry[] = await Promise.all(
                orgRecords.map(async org => {
                    let ownerEmail: string | null = null
                    let ownerId: string | null = null
                    let ownerName: string | null = null
                    try {
                        const userOrg = await pb
                            .collection('user_org')
                            .getFirstListItem(`org="${org.id}" && role="owner"`, {
                                expand: 'user',
                            })
                        const expanded = userOrg.expand as
                            | Record<string, { id?: string; email?: string; name?: string }>
                            | undefined
                        ownerEmail = expanded?.user?.email ?? null
                        ownerId = expanded?.user?.id ?? null
                        ownerName = expanded?.user?.name ?? null
                    } catch {
                        // no owner found
                    }
                    return {
                        id: org.id,
                        name: org.name as string,
                        slug: org.slug as string,
                        ownerEmail,
                        ownerId,
                        ownerName,
                        created: org.created as string,
                    }
                })
            )
            setOrgs(entries)
        } catch (err) {
            captureException('Failed to fetch orgs', err)
        } finally {
            setIsLoadingOrgs(false)
        }
    }, [pb])

    useEffect(() => {
        fetchOrgs()
    }, [fetchOrgs])

    if (!isVisible) return null

    const toggleExpanded = (orgId: string) => {
        setExpandedOrgId(prev => (prev === orgId ? null : orgId))
    }

    return (
        <>
            <View className="flex-row justify-between items-center">
                <Text className="text-foreground" style={{ fontSize: 24, fontWeight: 'bold' }}>
                    Organizations
                </Text>
                <Pressable
                    onPress={() => setShowCreateForm(v => !v)}
                    className="px-3 py-2 rounded-lg self-start bg-primary"
                >
                    <Text
                        className="text-primary-foreground"
                        style={{ fontWeight: '600', fontSize: 14 }}
                    >
                        {showCreateForm ? 'Cancel' : 'New Organization'}
                    </Text>
                </Pressable>
            </View>

            <CreateOrgSection
                isVisible={showCreateForm}
                pb={pb}
                onCreated={() => {
                    setShowCreateForm(false)
                    fetchOrgs()
                }}
            />

            <OrgList
                orgs={orgs}
                isLoading={isLoadingOrgs}
                expandedOrgId={expandedOrgId}
                onToggleExpanded={toggleExpanded}
                pb={pb}
                onUpdated={fetchOrgs}
            />
        </>
    )
}

function OrgList({
    orgs,
    isLoading,
    expandedOrgId,
    onToggleExpanded,
    pb,
    onUpdated,
}: {
    orgs: OrgEntry[]
    isLoading: boolean
    expandedOrgId: string | null
    onToggleExpanded: (id: string) => void
    pb: PocketBase
    onUpdated: () => void
}) {
    const mutedColor = useThemeColor('muted-foreground')

    if (isLoading) {
        return (
            <View className="p-5 items-center">
                <ActivityIndicator size="large" color={mutedColor} />
            </View>
        )
    }

    if (orgs.length === 0) {
        return (
            <View className="p-5 items-center rounded-xl border bg-surface-secondary border-border">
                <Text className="text-muted-foreground" style={{ fontSize: 16 }}>
                    No organizations yet. Create one to get started.
                </Text>
            </View>
        )
    }

    return (
        <View className="rounded-xl border overflow-hidden bg-surface-secondary border-border">
            {orgs.map((org, i) => (
                <View key={org.id}>
                    {i > 0 && <Divider />}
                    <OrgRow
                        org={org}
                        isExpanded={expandedOrgId === org.id}
                        onToggle={() => onToggleExpanded(org.id)}
                        pb={pb}
                        onUpdated={onUpdated}
                    />
                </View>
            ))}
        </View>
    )
}

function OrgRow({
    org,
    isExpanded,
    onToggle,
    pb,
    onUpdated,
}: {
    org: OrgEntry
    isExpanded: boolean
    onToggle: () => void
    pb: PocketBase
    onUpdated: () => void
}) {
    const mutedColor = useThemeColor('muted-foreground')
    const primaryBg = useThemeColor('primary')

    return (
        <View>
            <Pressable
                onPress={onToggle}
                className="flex-row items-center justify-between px-4 py-3"
            >
                <View className="flex-1 gap-1">
                    <View className="flex-row gap-2 items-center">
                        <Text
                            className="text-foreground"
                            style={{ fontSize: 16, fontWeight: '600' }}
                        >
                            {org.name}
                        </Text>
                        <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
                            {org.slug}
                        </Text>
                    </View>
                    <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
                        {org.ownerEmail ?? 'No owner assigned'}
                    </Text>
                </View>
                <View className="flex-row gap-3 items-center">
                    <Pressable
                        onPress={async e => {
                            e.stopPropagation()
                            if (!org.ownerId) return
                            try {
                                const impersonated = await pb
                                    .collection('users')
                                    .impersonate(org.ownerId, 3600)
                                appPb.authStore.save(
                                    impersonated.authStore.token,
                                    impersonated.authStore.record
                                )
                                if (typeof window !== 'undefined') {
                                    window.location.href = `/a/${org.slug}`
                                }
                            } catch (err) {
                                captureException('Failed to impersonate user', err)
                            }
                        }}
                    >
                        <View className="flex-row gap-1 items-center">
                            <Text
                                className="text-primary"
                                style={{ fontSize: 12, fontWeight: '600' }}
                            >
                                visit
                            </Text>
                            <ExternalLink size={12} color={primaryBg} />
                        </View>
                    </Pressable>
                    {isExpanded ? (
                        <ChevronDown size={18} color={mutedColor} />
                    ) : (
                        <ChevronRight size={18} color={mutedColor} />
                    )}
                </View>
            </Pressable>

            <OrgExpandedDetails isVisible={isExpanded} org={org} pb={pb} onUpdated={onUpdated} />
        </View>
    )
}

function OrgExpandedDetails({
    isVisible,
    org,
    pb,
    onUpdated,
}: {
    isVisible: boolean
    org: OrgEntry
    pb: PocketBase
    onUpdated: () => void
}) {
    const [isSaving, setIsSaving] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)

    const {
        control,
        handleSubmit,
        formState: { errors, isSubmitted, isDirty },
    } = useForm({
        resolver: zodResolver(editOrgSchema),
        defaultValues: {
            name: org.name,
            ownerName: org.ownerName ?? '',
            ownerEmail: org.ownerEmail ?? '',
            ownerPassword: '',
        },
        mode: 'onChange',
    })

    const onSave = handleSubmit(async data => {
        setSaveError(null)
        setIsSaving(true)
        try {
            await pb.collection('orgs').update(org.id, { name: data.name })
            if (org.ownerId) {
                const userUpdate: Record<string, string> = {
                    name: data.ownerName,
                    email: data.ownerEmail,
                }
                if (data.ownerPassword) {
                    userUpdate.password = data.ownerPassword
                    userUpdate.passwordConfirm = data.ownerPassword
                }
                await pb.collection('users').update(org.ownerId, userUpdate)
            }
            onUpdated()
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : 'Failed to update')
        } finally {
            setIsSaving(false)
        }
    })

    if (!isVisible) return null

    const createdDate = org.created
        ? new Date(org.created).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
          })
        : null

    const saveEnabled = isDirty && !isSaving

    return (
        <View className="px-4 pb-4 gap-4">
            <Divider />

            <FormErrorSummary errors={errors} isEnabled={isSubmitted} />

            {saveError && (
                <View className="rounded-lg p-2 bg-danger-soft">
                    <Text className="text-xs text-danger">{saveError}</Text>
                </View>
            )}

            <View className="gap-3">
                <Text
                    className="text-muted-foreground"
                    style={{
                        fontSize: 12,
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                    }}
                >
                    Organization
                </Text>

                <View className="flex-row gap-3 flex-wrap">
                    <View className="flex-1 min-w-[200px]">
                        <TextInput control={control} name="name" label="Name" />
                    </View>
                    <View className="flex-1 min-w-[200px] gap-1">
                        <Text
                            className="text-foreground"
                            style={{ fontSize: 14, fontWeight: '600' }}
                        >
                            Slug
                        </Text>
                        <Text
                            className="text-muted-foreground"
                            style={{ fontSize: 14, paddingVertical: 8 }}
                        >
                            {org.slug}
                        </Text>
                        {createdDate && (
                            <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
                                Created {createdDate}
                            </Text>
                        )}
                    </View>
                </View>
            </View>

            <Divider />

            <View className="gap-3">
                <Text
                    className="text-muted-foreground"
                    style={{
                        fontSize: 12,
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                    }}
                >
                    Owner
                </Text>

                {org.ownerId ? (
                    <View className="flex-row gap-3 flex-wrap">
                        <View className="flex-1 min-w-[200px]">
                            <TextInput control={control} name="ownerName" label="Name" />
                        </View>
                        <View className="flex-1 min-w-[200px]">
                            <TextInput
                                control={control}
                                name="ownerEmail"
                                label="Email"
                                keyboardType="email-address"
                                autoCapitalize="none"
                            />
                        </View>
                        <View className="flex-1 min-w-[200px]">
                            <TextInput
                                control={control}
                                name="ownerPassword"
                                label="New Password"
                                placeholder="Leave blank to keep current"
                                secureTextEntry
                            />
                        </View>
                    </View>
                ) : (
                    <Text className="text-muted-foreground" style={{ fontSize: 14 }}>
                        No owner assigned to this organization.
                    </Text>
                )}
            </View>

            <Pressable
                onPress={onSave}
                disabled={!saveEnabled}
                className={`px-3 py-2 rounded-lg self-start bg-primary ${saveEnabled ? 'opacity-100' : 'opacity-50'}`}
            >
                <Text
                    className="text-primary-foreground"
                    style={{ fontWeight: '600', fontSize: 14 }}
                >
                    {isSaving ? 'Saving...' : 'Save Changes'}
                </Text>
            </Pressable>
        </View>
    )
}

function CreateOrgSection({
    isVisible,
    pb,
    onCreated,
}: {
    isVisible: boolean
    pb: PocketBase
    onCreated: () => void
}) {
    const [submitError, setSubmitError] = useState<string | null>(null)
    const [isCreating, setIsCreating] = useState(false)

    const {
        control,
        handleSubmit,
        setValue,
        watch,
        reset,
        formState: { errors, isSubmitted },
    } = useForm({
        resolver: zodResolver(setupSchema),
        defaultValues: {
            orgName: '',
            orgSlug: '',
            ownerName: '',
            email: '',
            password: '',
            mailDomain: '',
        },
        mode: 'onChange',
    })

    const orgName = watch('orgName')
    const orgSlug = watch('orgSlug')

    useEffect(() => {
        const prev = deriveSlug(orgName.slice(0, -1))
        if (!orgSlug || orgSlug === prev) {
            setValue('orgSlug', deriveSlug(orgName))
        }
    }, [orgName, orgSlug, setValue])

    const onSubmit = handleSubmit(async data => {
        setSubmitError(null)
        setIsCreating(true)

        let userId: string | null = null
        let orgId: string | null = null

        try {
            const base = deriveUsername(data.email)
            let user: { id: string } | null = null
            let lastErr: unknown = null
            for (let i = 0; i < 20; i++) {
                const candidate = i === 0 ? base : `${base}${i + 1}`
                try {
                    user = await pb.collection('users').create({
                        username: candidate,
                        email: data.email,
                        password: data.password,
                        passwordConfirm: data.password,
                        name: data.ownerName,
                        emailVisibility: true,
                        verified: true,
                    })
                    break
                } catch (err) {
                    lastErr = err
                    const validation = (err as { response?: { data?: Record<string, unknown> } })
                        ?.response?.data
                    const usernameErr = validation?.username as { code?: string } | undefined
                    if (usernameErr?.code === 'validation_not_unique') continue
                    throw err
                }
            }
            if (!user) throw lastErr ?? new Error('Failed to allocate a unique username')
            userId = user.id

            const org = await pb.collection('orgs').create({
                name: data.orgName,
                slug: data.orgSlug,
            })
            orgId = org.id

            if (mailInstalled && data.mailDomain) {
                await pb.collection('mail_domains').create({
                    org: orgId,
                    domain: data.mailDomain.trim().toLowerCase(),
                    verified: true,
                })
            }

            await pb.collection('user_org').create({
                user: userId,
                org: orgId,
                role: 'owner',
            })

            reset()
            onCreated()
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to create org'
            setSubmitError(message)

            if (orgId) {
                try {
                    await pb.collection('orgs').delete(orgId)
                } catch (cleanupErr) {
                    captureException('Cleanup failed: could not delete org', cleanupErr)
                }
            }
            if (userId) {
                try {
                    await pb.collection('users').delete(userId)
                } catch (cleanupErr) {
                    captureException('Cleanup failed: could not delete user', cleanupErr)
                }
            }
        } finally {
            setIsCreating(false)
        }
    })

    if (!isVisible) return null

    return (
        <View className="rounded-xl border overflow-hidden bg-surface-secondary border-border">
            <View className="p-4 gap-4">
                <Text
                    className="text-muted-foreground"
                    style={{
                        fontSize: 12,
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                    }}
                >
                    New Organization + Owner
                </Text>

                <FormErrorSummary errors={errors} isEnabled={isSubmitted} />

                {submitError && (
                    <View className="rounded-lg p-2 bg-danger-soft">
                        <Text className="text-xs text-danger">{submitError}</Text>
                    </View>
                )}

                <View className="flex-row gap-3 flex-wrap">
                    <View className="flex-1 min-w-[200px]">
                        <TextInput
                            control={control}
                            name="orgName"
                            label="Organization Name"
                            placeholder="Acme Corp"
                        />
                    </View>
                    <View className="flex-1 min-w-[200px]">
                        <TextInput
                            control={control}
                            name="orgSlug"
                            label="Slug"
                            placeholder="acme-corp"
                            autoCapitalize="none"
                            hint="3-15 chars, lowercase, hyphens"
                        />
                    </View>
                </View>

                <Divider />

                <View className="flex-row gap-3 flex-wrap">
                    <View className="flex-1 min-w-[200px]">
                        <TextInput
                            control={control}
                            name="ownerName"
                            label="Owner Name"
                            placeholder="Jane Smith"
                        />
                    </View>
                    <View className="flex-1 min-w-[200px]">
                        <TextInput
                            control={control}
                            name="email"
                            label="Owner Email"
                            placeholder="owner@example.com"
                            keyboardType="email-address"
                            autoCapitalize="none"
                        />
                    </View>
                    <View className="flex-1 min-w-[200px]">
                        <TextInput
                            control={control}
                            name="password"
                            label="Owner Password"
                            placeholder="At least 8 characters"
                            secureTextEntry
                        />
                    </View>
                </View>

                {mailInstalled && (
                    <>
                        <Divider />
                        <View className="flex-row gap-3 flex-wrap">
                            <View className="flex-1 min-w-[200px]">
                                <TextInput
                                    control={control}
                                    name="mailDomain"
                                    label="Mail Domain"
                                    placeholder="example.com"
                                    autoCapitalize="none"
                                    hint="A personal mailbox is created under this domain for the owner"
                                />
                            </View>
                        </View>
                    </>
                )}

                <Pressable
                    onPress={onSubmit}
                    disabled={isCreating}
                    className={`px-3 py-2 rounded-lg self-start bg-primary ${isCreating ? 'opacity-60' : 'opacity-100'}`}
                >
                    <Text
                        className="text-primary-foreground"
                        style={{ fontWeight: '600', fontSize: 14 }}
                    >
                        {isCreating ? 'Creating...' : 'Create Organization'}
                    </Text>
                </Pressable>
            </View>
        </View>
    )
}
