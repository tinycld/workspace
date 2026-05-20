import { DragHandle } from '@tinycld/core/components/DragHandle'
import { PB_SERVER_ADDR } from '@tinycld/core/lib/config'
import { captureException } from '@tinycld/core/lib/errors'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Divider } from '@tinycld/core/ui/divider'
import { FormErrorSummary, TextInput, useForm, z, zodResolver } from '@tinycld/core/ui/form'
import { Switch } from '@tinycld/core/ui/switch'
import { Download, Package, Pencil, Trash2, X } from 'lucide-react-native'
import type PocketBase from 'pocketbase'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import DraggableFlatList, {
    type RenderItemParams,
    ScaleDecorator,
} from 'react-native-draggable-flatlist'
import { InstallProgressModal } from './InstallProgressModal'
import { PackageStatusBadge } from './PackageStatusBadge'

interface PkgRecord {
    id: string
    name: string
    slug: string
    npm_package: string
    version: string
    status: string
    icon: string
    description: string
    nav_order: number
    has_server: boolean
}

const registerSchema = z.object({
    name: z.string().min(1, 'Required'),
    slug: z
        .string()
        .min(1, 'Required')
        .regex(/^[a-z0-9][a-z0-9-]*$/, 'Lowercase letters, numbers, hyphens'),
    npm_package: z.string().min(1, 'Required'),
    description: z.string(),
})

interface PackageManagerProps {
    pb: PocketBase
}

export function PackageManager({ pb }: PackageManagerProps) {
    const primaryFgColor = useThemeColor('primary-foreground')
    const mutedColor = useThemeColor('muted-foreground')
    const [packages, setPackages] = useState<PkgRecord[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [showRegister, setShowRegister] = useState(false)
    const [showInstall, setShowInstall] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [installJobId, setInstallJobId] = useState<string | null>(null)

    const fetchPackages = useCallback(async () => {
        setIsLoading(true)
        try {
            const records = await pb
                .collection('pkg_registry')
                .getFullList<PkgRecord>({ sort: 'nav_order,name' })
            setPackages(records)
        } catch (err) {
            captureException('Failed to fetch packages', err)
        } finally {
            setIsLoading(false)
        }
    }, [pb])

    useEffect(() => {
        fetchPackages()
    }, [fetchPackages])

    const handleInstallStarted = useCallback((jobId: string) => {
        setShowInstall(false)
        setInstallJobId(jobId)
    }, [])

    const handleUninstallStarted = useCallback((jobId: string) => {
        setInstallJobId(jobId)
    }, [])

    return (
        <View className="gap-5">
            <View className="flex-row justify-between items-center">
                <Text className="text-foreground" style={{ fontSize: 24, fontWeight: 'bold' }}>
                    Packages
                </Text>
                <View className="flex-row gap-2">
                    <Pressable
                        onPress={() => {
                            setShowInstall(v => !v)
                            setShowRegister(false)
                        }}
                        className="flex-row gap-1.5 items-center px-3 py-2 rounded-lg bg-primary"
                    >
                        <Download size={14} color={primaryFgColor} />
                        <Text
                            className="text-primary-foreground"
                            style={{ fontWeight: '600', fontSize: 14 }}
                        >
                            {showInstall ? 'Cancel' : 'Install'}
                        </Text>
                    </Pressable>
                    <Pressable
                        onPress={() => {
                            setShowRegister(v => !v)
                            setShowInstall(false)
                        }}
                        className="flex-row gap-1.5 items-center px-3 py-2 rounded-lg border border-muted-foreground/25"
                    >
                        <Package size={14} color={mutedColor} />
                        <Text
                            className="text-muted-foreground"
                            style={{ fontWeight: '500', fontSize: 14 }}
                        >
                            {showRegister ? 'Cancel' : 'New Package'}
                        </Text>
                    </Pressable>
                </View>
            </View>

            <InstallPackageForm isVisible={showInstall} pb={pb} onStarted={handleInstallStarted} />

            <InstallProgressModal
                isVisible={installJobId !== null}
                jobId={installJobId}
                authToken={pb.authStore.token}
                onClose={() => {
                    setInstallJobId(null)
                    fetchPackages()
                }}
                onComplete={fetchPackages}
            />

            <RegisterPackageForm
                isVisible={showRegister}
                pb={pb}
                onCreated={() => {
                    setShowRegister(false)
                    fetchPackages()
                }}
            />

            <PackageList
                packages={packages}
                isLoading={isLoading}
                pb={pb}
                editingId={editingId}
                onEdit={setEditingId}
                onUpdated={fetchPackages}
                onUninstallStarted={handleUninstallStarted}
            />
        </View>
    )
}

function PackageList({
    packages,
    isLoading,
    pb,
    editingId,
    onEdit,
    onUpdated,
    onUninstallStarted,
}: {
    packages: PkgRecord[]
    isLoading: boolean
    pb: PocketBase
    editingId: string | null
    onEdit: (id: string | null) => void
    onUpdated: () => void
    onUninstallStarted: (jobId: string) => void
}) {
    const surfaceBg = useThemeColor('surface-secondary')
    const borderColor = useThemeColor('border')
    const mutedColor = useThemeColor('muted-foreground')
    const accentColor = useThemeColor('accent')

    const pkgMap = new Map(packages.map(p => [p.id, p]))

    const handleDragEnd = useCallback(
        async ({ data }: { data: PkgRecord[] }) => {
            try {
                await Promise.all(
                    data.map((pkg, i) =>
                        pb.collection('pkg_registry').update(pkg.id, { nav_order: i * 10 })
                    )
                )
                onUpdated()
            } catch (err) {
                captureException('Failed to save package order', err)
            }
        },
        [pb, onUpdated]
    )

    function renderItem({ item, drag, isActive }: RenderItemParams<PkgRecord>) {
        const pkg = pkgMap.get(item.id) ?? item
        const isEditing = editingId === pkg.id

        return (
            <ScaleDecorator activeScale={1}>
                <View
                    style={{
                        backgroundColor: isActive ? `${accentColor}20` : surfaceBg,
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderColor,
                    }}
                >
                    <View className="flex-row items-center px-4 py-3.5">
                        <DragHandle drag={drag} disabled={isActive} color={mutedColor} />
                        <View className="flex-1 gap-0.5">
                            <View className="flex-row gap-2 items-center">
                                <Text
                                    style={{
                                        fontSize: 15,
                                        fontWeight: '600',
                                        color: isActive ? mutedColor : undefined,
                                    }}
                                    className="text-foreground"
                                >
                                    {pkg.name}
                                </Text>
                                <PackageStatusBadge status={pkg.status} />
                            </View>
                            {pkg.description ? (
                                <Text
                                    className="text-muted-foreground"
                                    style={{ fontSize: 13 }}
                                    numberOfLines={1}
                                >
                                    {pkg.description}
                                </Text>
                            ) : (
                                <Text style={{ fontSize: 12, color: `${mutedColor}80` }}>
                                    {pkg.slug}
                                    {pkg.version ? ` · v${pkg.version}` : ''}
                                </Text>
                            )}
                        </View>
                        <PackageActions
                            pkg={pkg}
                            pb={pb}
                            isEditing={isEditing}
                            onEdit={() => onEdit(isEditing ? null : pkg.id)}
                            onUpdated={onUpdated}
                            onUninstallStarted={onUninstallStarted}
                        />
                    </View>
                    <EditPackageForm
                        isVisible={isEditing}
                        pkg={pkg}
                        pb={pb}
                        onClose={() => onEdit(null)}
                        onUpdated={onUpdated}
                    />
                </View>
            </ScaleDecorator>
        )
    }

    const keyExtractor = useCallback((item: PkgRecord) => item.id, [])

    if (isLoading) {
        return (
            <View className="p-8 items-center">
                <ActivityIndicator size="large" color={mutedColor} />
            </View>
        )
    }

    if (packages.length === 0) {
        return (
            <View className="p-8 items-center rounded-xl border gap-2 bg-surface-secondary border-border">
                <Package size={32} color={`${mutedColor}60`} />
                <Text className="text-muted-foreground" style={{ fontSize: 15 }}>
                    No packages installed yet
                </Text>
            </View>
        )
    }

    return (
        <View className="rounded-xl border overflow-hidden bg-surface-secondary border-border">
            <DraggableFlatList
                data={packages}
                keyExtractor={keyExtractor}
                onDragEnd={handleDragEnd}
                renderItem={renderItem}
                scrollEnabled={false}
                activationDistance={1}
            />
        </View>
    )
}

function PackageActions({
    pkg,
    pb,
    isEditing,
    onEdit,
    onUpdated,
    onUninstallStarted,
}: {
    pkg: PkgRecord
    pb: PocketBase
    isEditing: boolean
    onEdit: () => void
    onUpdated: () => void
    onUninstallStarted: (jobId: string) => void
}) {
    const mutedColor = useThemeColor('muted-foreground')
    const dangerColor = useThemeColor('danger')
    const dangerFgColor = useThemeColor('danger-foreground')
    const primaryBg = useThemeColor('primary')
    const [isToggling, setIsToggling] = useState(false)
    const [confirmUninstall, setConfirmUninstall] = useState(false)

    const isEnabled = pkg.status !== 'disabled'
    const isInstalled = pkg.status === 'installed'

    const toggleStatus = async () => {
        setIsToggling(true)
        try {
            const isBundled = pkg.status === 'bundled'
            const newStatus = isEnabled ? 'disabled' : isBundled ? 'bundled' : 'installed'
            await pb.collection('pkg_registry').update(pkg.id, { status: newStatus })
            onUpdated()
        } catch (err) {
            captureException('Failed to toggle package status', err)
        } finally {
            setIsToggling(false)
        }
    }

    const handleUninstall = async () => {
        try {
            const response = await fetch(`${PB_SERVER_ADDR}/api/admin/packages/uninstall`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: pb.authStore.token,
                },
                body: JSON.stringify({ slug: pkg.slug }),
            })
            const data = await response.json()
            if (response.ok) {
                setConfirmUninstall(false)
                onUninstallStarted(data.jobId)
            }
        } catch (err) {
            captureException('Failed to start uninstall', err)
        }
    }

    return (
        <View className="flex-row gap-3 items-center">
            <Switch value={isEnabled} onValueChange={toggleStatus} disabled={isToggling} />
            <Pressable
                onPress={onEdit}
                className="p-1.5 rounded-md"
                style={{ backgroundColor: isEditing ? `${primaryBg}15` : 'transparent' }}
            >
                <Pencil size={15} color={isEditing ? primaryBg : mutedColor} />
            </Pressable>
            <UninstallButton
                isVisible={isInstalled}
                isConfirming={confirmUninstall}
                onPress={() => setConfirmUninstall(true)}
                onConfirm={handleUninstall}
                onCancel={() => setConfirmUninstall(false)}
                color={dangerColor}
                textColor={dangerFgColor}
                mutedColor={mutedColor}
            />
        </View>
    )
}

function UninstallButton({
    isVisible,
    isConfirming,
    onPress,
    onConfirm,
    onCancel,
    color,
    textColor,
    mutedColor,
}: {
    isVisible: boolean
    isConfirming: boolean
    onPress: () => void
    onConfirm: () => void
    onCancel: () => void
    color: string
    textColor: string
    mutedColor: string
}) {
    if (!isVisible) return null
    if (isConfirming) {
        return (
            <View className="flex-row gap-1 items-center">
                <Pressable
                    onPress={onConfirm}
                    className="px-2.5 py-1 rounded-md"
                    style={{ backgroundColor: color }}
                >
                    <Text style={{ fontSize: 12, fontWeight: '600', color: textColor }}>
                        Uninstall
                    </Text>
                </Pressable>
                <Pressable onPress={onCancel} className="p-1">
                    <X size={14} color={mutedColor} />
                </Pressable>
            </View>
        )
    }
    return (
        <Pressable onPress={onPress} className="p-1.5 rounded-md">
            <Trash2 size={15} color={color} />
        </Pressable>
    )
}

const editSchema = z.object({
    name: z.string().min(1, 'Required'),
    description: z.string(),
    icon: z.string(),
    nav_order: z.string(),
})

function EditPackageForm({
    isVisible,
    pkg,
    pb,
    onClose,
    onUpdated,
}: {
    isVisible: boolean
    pkg: PkgRecord
    pb: PocketBase
    onClose: () => void
    onUpdated: () => void
}) {
    const mutedColor = useThemeColor('muted-foreground')
    const dangerColor = useThemeColor('danger')
    const borderColor = useThemeColor('border')
    const [isSaving, setIsSaving] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)
    const [confirmRemove, setConfirmRemove] = useState(false)

    const handleRemove = async () => {
        try {
            await pb.collection('pkg_registry').delete(pkg.id)
            onClose()
            onUpdated()
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : 'Failed to remove')
        }
    }

    const {
        control,
        handleSubmit,
        formState: { errors, isSubmitted, isDirty },
    } = useForm({
        resolver: zodResolver(editSchema),
        defaultValues: {
            name: pkg.name,
            description: pkg.description ?? '',
            icon: pkg.icon ?? '',
            nav_order: String(pkg.nav_order ?? 0),
        },
        mode: 'onChange',
    })

    const onSave = handleSubmit(async data => {
        setSaveError(null)
        setIsSaving(true)
        try {
            await pb.collection('pkg_registry').update(pkg.id, {
                name: data.name,
                description: data.description,
                icon: data.icon,
                nav_order: Number(data.nav_order) || 0,
            })
            onClose()
            onUpdated()
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : 'Failed to update')
        } finally {
            setIsSaving(false)
        }
    })

    if (!isVisible) return null

    const saveEnabled = isDirty && !isSaving

    return (
        <View
            className="mx-3 mb-3 rounded-lg p-4 gap-3"
            style={{
                backgroundColor: `${borderColor}30`,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor,
            }}
        >
            <View className="flex-row items-center justify-between">
                <Text
                    className="text-muted-foreground"
                    style={{
                        fontSize: 12,
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                    }}
                >
                    Edit Package
                </Text>
                <View className="flex-row items-center gap-1">
                    <Text style={{ fontSize: 12, color: `${mutedColor}80` }}>{pkg.slug}</Text>
                    {pkg.version ? (
                        <Text style={{ fontSize: 12, color: `${mutedColor}60` }}>
                            · v{pkg.version}
                        </Text>
                    ) : null}
                </View>
            </View>

            <FormErrorSummary errors={errors} isEnabled={isSubmitted} />
            {saveError && (
                <View className="rounded-md p-2.5 bg-danger-soft">
                    <Text className="text-xs text-danger">{saveError}</Text>
                </View>
            )}

            <View className="flex-row gap-3 flex-wrap">
                <View className="flex-1 min-w-[150px]">
                    <TextInput control={control} name="name" label="Name" />
                </View>
                <View style={{ width: 120 }}>
                    <TextInput control={control} name="icon" label="Icon" />
                </View>
                <View style={{ width: 72 }}>
                    <TextInput control={control} name="nav_order" label="Order" />
                </View>
            </View>
            <TextInput control={control} name="description" label="Description" />

            <Divider />

            <View className="flex-row items-center">
                {confirmRemove ? (
                    <View className="flex-row gap-1.5 items-center">
                        <Pressable
                            onPress={handleRemove}
                            className="px-3 py-1.5 rounded-md bg-danger"
                        >
                            <Text
                                className="text-danger-foreground"
                                style={{ fontWeight: '600', fontSize: 13 }}
                            >
                                Confirm Remove
                            </Text>
                        </Pressable>
                        <Pressable onPress={() => setConfirmRemove(false)} className="p-1.5">
                            <X size={14} color={mutedColor} />
                        </Pressable>
                    </View>
                ) : (
                    <Pressable
                        onPress={() => setConfirmRemove(true)}
                        className="flex-row gap-1 items-center px-2.5 py-1.5 rounded-md"
                    >
                        <Trash2 size={13} color={dangerColor} />
                        <Text className="text-danger" style={{ fontWeight: '500', fontSize: 13 }}>
                            Remove
                        </Text>
                    </Pressable>
                )}
                <View className="flex-1" />
                <View className="flex-row gap-2 items-center">
                    <Pressable onPress={onClose} className="px-3 py-1.5 rounded-md">
                        <Text
                            className="text-muted-foreground"
                            style={{ fontWeight: '500', fontSize: 13 }}
                        >
                            Cancel
                        </Text>
                    </Pressable>
                    <Pressable
                        onPress={onSave}
                        disabled={!saveEnabled}
                        className={`px-4 py-1.5 rounded-md bg-primary ${saveEnabled ? 'opacity-100' : 'opacity-40'}`}
                    >
                        <Text
                            className="text-primary-foreground"
                            style={{ fontWeight: '600', fontSize: 13 }}
                        >
                            {isSaving ? 'Saving...' : 'Save'}
                        </Text>
                    </Pressable>
                </View>
            </View>
        </View>
    )
}

function RegisterPackageForm({
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
        reset,
        formState: { errors, isSubmitted },
    } = useForm({
        resolver: zodResolver(registerSchema),
        defaultValues: { name: '', slug: '', npm_package: '', description: '' },
        mode: 'onChange',
    })

    const onSubmit = handleSubmit(async data => {
        setSubmitError(null)
        setIsCreating(true)
        try {
            await pb.collection('pkg_registry').create({
                ...data,
                status: 'available',
                nav_order: 0,
            })
            reset()
            onCreated()
        } catch (err) {
            setSubmitError(err instanceof Error ? err.message : 'Failed to register')
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
                    Create New Package
                </Text>

                <FormErrorSummary errors={errors} isEnabled={isSubmitted} />

                {submitError && (
                    <View className="rounded-md p-2.5 bg-danger-soft">
                        <Text className="text-xs text-danger">{submitError}</Text>
                    </View>
                )}

                <View className="flex-row gap-3 flex-wrap">
                    <View className="flex-1 min-w-[200px]">
                        <TextInput
                            control={control}
                            name="name"
                            label="Name"
                            placeholder="My Package"
                        />
                    </View>
                    <View className="flex-1 min-w-[200px]">
                        <TextInput
                            control={control}
                            name="slug"
                            label="Slug"
                            placeholder="my-package"
                            autoCapitalize="none"
                        />
                    </View>
                </View>
                <View className="flex-row gap-3 flex-wrap">
                    <View className="flex-1 min-w-[200px]">
                        <TextInput
                            control={control}
                            name="npm_package"
                            label="npm Package / Git URL"
                            placeholder="@scope/package"
                            autoCapitalize="none"
                        />
                    </View>
                    <View className="flex-1 min-w-[200px]">
                        <TextInput
                            control={control}
                            name="description"
                            label="Description"
                            placeholder="Optional description"
                        />
                    </View>
                </View>

                <Pressable
                    onPress={onSubmit}
                    disabled={isCreating}
                    className={`px-4 py-2 rounded-lg self-start bg-primary ${isCreating ? 'opacity-60' : 'opacity-100'}`}
                >
                    <Text
                        className="text-primary-foreground"
                        style={{ fontWeight: '600', fontSize: 14 }}
                    >
                        {isCreating ? 'Creating...' : 'Create'}
                    </Text>
                </Pressable>
            </View>
        </View>
    )
}

const installSchema = z.object({
    npm_package: z.string().min(1, 'Required'),
})

function InstallPackageForm({
    isVisible,
    pb,
    onStarted,
}: {
    isVisible: boolean
    pb: PocketBase
    onStarted: (jobId: string) => void
}) {
    const warningColor = useThemeColor('warning')
    const [submitError, setSubmitError] = useState<string | null>(null)
    const [isInstalling, setIsInstalling] = useState(false)

    const {
        control,
        handleSubmit,
        reset,
        watch,
        formState: { errors, isSubmitted },
    } = useForm({
        resolver: zodResolver(installSchema),
        defaultValues: { npm_package: '' },
        mode: 'onChange',
    })

    const npmValue = watch('npm_package')
    const showWarning = npmValue.length > 0 && !npmValue.startsWith('@tinycld/')

    const onSubmit = handleSubmit(async data => {
        setSubmitError(null)
        setIsInstalling(true)
        try {
            const response = await fetch(`${PB_SERVER_ADDR}/api/admin/packages/install`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: pb.authStore.token,
                },
                body: JSON.stringify({ npmPackage: data.npm_package }),
            })
            const result = await response.json()
            if (!response.ok) {
                setSubmitError(result.error ?? 'Failed to start install')
                return
            }
            reset()
            onStarted(result.jobId)
        } catch (err) {
            setSubmitError(err instanceof Error ? err.message : 'Failed to start install')
        } finally {
            setIsInstalling(false)
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
                    Install Package from npm
                </Text>

                <FormErrorSummary errors={errors} isEnabled={isSubmitted} />

                {submitError && (
                    <View className="rounded-md p-2.5 bg-danger-soft">
                        <Text className="text-xs text-danger">{submitError}</Text>
                    </View>
                )}

                <SecurityWarning isVisible={showWarning} warningColor={warningColor} />

                <View className="flex-row gap-3 items-end flex-wrap">
                    <View className="flex-1 min-w-[300px]">
                        <TextInput
                            control={control}
                            name="npm_package"
                            label="npm Package Name"
                            placeholder="@tinycld/my-package"
                            autoCapitalize="none"
                        />
                    </View>
                    <Pressable
                        onPress={onSubmit}
                        disabled={isInstalling}
                        className={`px-4 py-2.5 rounded-lg bg-primary ${isInstalling ? 'opacity-60' : 'opacity-100'}`}
                    >
                        <Text
                            className="text-primary-foreground"
                            style={{ fontWeight: '600', fontSize: 14 }}
                        >
                            {isInstalling ? 'Starting...' : 'Install'}
                        </Text>
                    </Pressable>
                </View>
            </View>
        </View>
    )
}

function SecurityWarning({
    isVisible,
    warningColor,
}: {
    isVisible: boolean
    warningColor: string
}) {
    if (!isVisible) return null
    return (
        <View
            className="rounded-lg p-3"
            style={{
                backgroundColor: `${warningColor}15`,
                borderColor: `${warningColor}40`,
                borderWidth: 1,
            }}
        >
            <Text className="text-warning" style={{ fontSize: 13 }}>
                This package is not in the @tinycld/ scope. Only install packages you trust.
            </Text>
        </View>
    )
}
