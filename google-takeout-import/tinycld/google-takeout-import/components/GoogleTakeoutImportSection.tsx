import { usePackages } from '@tinycld/core/lib/packages/use-packages'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useCurrentRole } from '@tinycld/core/lib/use-current-role'
import { useOrgInfo } from '@tinycld/core/lib/use-org-info'
import { Switch } from '@tinycld/core/ui/switch'
import {
    AlertTriangle,
    Calendar,
    Check,
    ChevronDown,
    ChevronUp,
    HardDrive,
    Mail,
    Upload,
    Users,
} from 'lucide-react-native'
import { useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { useDefaultMailbox } from '../hooks/useDefaultMailbox'
import { useTakeoutImport } from '../lib/takeout-import'
import type { ImportProgress, ImportService } from '../lib/takeout-import/types'

const SERVICE_META: Record<ImportService, { label: string; Icon: typeof Users }> = {
    contacts: { label: 'Contacts', Icon: Users },
    calendar: { label: 'Calendar', Icon: Calendar },
    drive: { label: 'Drive', Icon: HardDrive },
    mail: { label: 'Mail', Icon: Mail },
}

export function GoogleTakeoutImportSection() {
    const { orgId } = useOrgInfo()
    const { userOrgId } = useCurrentRole()
    const mailboxId = useDefaultMailbox()
    const packages = usePackages()
    const installedSlugs = new Set(packages.map((p) => p.slug))

    const { selectFiles, startImport, requestCancel, store } = useTakeoutImport({
        orgId,
        userOrgId,
        mailboxId,
    })

    const { detection, phase, overallError, progress, activeServices, selectedServices } = store

    const detectedServices: ImportService[] = []
    if (detection?.hasContacts && installedSlugs.has('contacts')) detectedServices.push('contacts')
    if (detection?.hasCalendar && installedSlugs.has('calendar')) detectedServices.push('calendar')
    if (detection?.hasDrive && installedSlugs.has('drive')) detectedServices.push('drive')
    if (detection?.hasMail && installedSlugs.has('mail') && mailboxId) detectedServices.push('mail')
    const mailDetectedNoMailbox = detection?.hasMail && installedSlugs.has('mail') && !mailboxId

    const effectiveSelectedServices = {
        ...selectedServices,
        mail: mailboxId ? selectedServices.mail : false,
    }

    const handleStartImport = () => {
        const services = detectedServices.filter((s) => effectiveSelectedServices[s])
        if (services.length > 0) startImport(services)
    }

    return (
        <View className="gap-3">
            <Text className="text-foreground" style={{ fontSize: 20, fontWeight: 'bold' }}>
                Import from Google
            </Text>
            <Text className="text-muted-foreground" style={{ fontSize: 13 }}>
                Import your data from Google Takeout. Select one or more .zip files exported from Google Takeout.
            </Text>

            <SectionCard>
                <TakeoutIdleState isVisible={phase === 'idle' && !detection} onSelectFiles={selectFiles} />
                <TakeoutDetectingState isVisible={phase === 'detecting'} />
                <TakeoutDetectedState
                    isVisible={phase === 'idle' && !!detection}
                    detection={detection}
                    detectedServices={detectedServices}
                    selectedServices={effectiveSelectedServices}
                    onToggleService={store.toggleService}
                    mailDetectedNoMailbox={!!mailDetectedNoMailbox}
                    onStartImport={handleStartImport}
                    onSelectFiles={selectFiles}
                />
                <TakeoutImportingState
                    isVisible={phase === 'importing'}
                    activeServices={activeServices}
                    progress={progress}
                    onCancel={requestCancel}
                    cancelRequested={store.cancelRequested}
                    fallbackActive={store.fallbackActive}
                />
                <TakeoutCompleteState
                    isVisible={phase === 'complete'}
                    activeServices={activeServices}
                    progress={progress}
                    onReset={store.reset}
                />
                <TakeoutErrorState isVisible={phase === 'error'} error={overallError} onReset={store.reset} />
            </SectionCard>
        </View>
    )
}

function SectionCard({ children }: { children: React.ReactNode }) {
    return <View className="rounded-xl border border-border bg-surface-secondary p-4">{children}</View>
}

function TakeoutIdleState({ isVisible, onSelectFiles }: { isVisible: boolean; onSelectFiles: () => void }) {
    const mutedColor = useThemeColor('muted-foreground')

    if (!isVisible) return null

    return (
        <View className="gap-3 items-center py-4">
            <Upload size={32} color={mutedColor} />
            <Text className="text-muted-foreground" style={{ fontSize: 14, textAlign: 'center' }}>
                Select your Google Takeout .zip files to get started.
            </Text>
            <Pressable onPress={onSelectFiles} className="px-4 py-2.5 rounded-lg bg-primary">
                <Text className="text-white" style={{ fontWeight: '600', fontSize: 14 }}>
                    Select Takeout Files
                </Text>
            </Pressable>
        </View>
    )
}

function TakeoutDetectingState({ isVisible }: { isVisible: boolean }) {
    if (!isVisible) return null

    return (
        <View className="gap-3 items-center py-4">
            <ActivityIndicator size="small" />
            <Text className="text-muted-foreground" style={{ fontSize: 14 }}>
                Scanning zip files...
            </Text>
        </View>
    )
}

function TakeoutDetectedState({
    isVisible,
    detection,
    detectedServices,
    selectedServices,
    onToggleService,
    mailDetectedNoMailbox,
    onStartImport,
    onSelectFiles,
}: {
    isVisible: boolean
    detection: ReturnType<typeof useTakeoutImport>['store']['detection']
    detectedServices: ImportService[]
    selectedServices: Record<ImportService, boolean>
    onToggleService: (svc: ImportService) => void
    mailDetectedNoMailbox: boolean
    onStartImport: () => void
    onSelectFiles: () => void
}) {
    const foregroundColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted-foreground')

    if (!isVisible || !detection) return null

    const serviceCounts: Record<ImportService, number> = {
        contacts: detection.contactCount,
        calendar: detection.eventCount,
        drive: detection.driveFileCount,
        mail: detection.mailThreadCount,
    }

    const countLabels: Record<ImportService, string> = {
        contacts: 'contacts',
        calendar: 'events',
        drive: 'files',
        mail: 'messages',
    }

    const hasSelection = detectedServices.some((s) => selectedServices[s])

    return (
        <View className="gap-4">
            <View className="gap-1">
                {(Object.keys(SERVICE_META) as ImportService[]).map((svc) => {
                    const { label, Icon } = SERVICE_META[svc]
                    const detected = detectedServices.includes(svc)
                    const selected = selectedServices[svc]
                    const count = serviceCounts[svc]
                    return (
                        <Pressable
                            key={svc}
                            onPress={() => detected && onToggleService(svc)}
                            disabled={!detected}
                            className="flex-row items-center gap-3 py-2"
                        >
                            <Switch
                                value={detected && selected}
                                disabled={!detected}
                                style={{ transform: [{ scale: 0.75 }], pointerEvents: 'none' }}
                            />
                            <Icon size={18} color={detected ? foregroundColor : mutedColor} />
                            <Text
                                className={detected ? 'text-foreground' : 'text-muted-foreground'}
                                style={{ fontSize: 14, flex: 1 }}
                            >
                                {label}
                                {detected && count > 0 && (
                                    <Text className="text-muted-foreground">
                                        {' '}
                                        — {count.toLocaleString()} {countLabels[svc]}
                                    </Text>
                                )}
                            </Text>
                        </Pressable>
                    )
                })}
            </View>

            <MailboxWarning isVisible={mailDetectedNoMailbox} />

            <View className="flex-row gap-3">
                <Pressable
                    onPress={onStartImport}
                    className={`px-4 py-2.5 rounded-lg ${hasSelection ? 'bg-primary' : 'bg-muted-foreground'}`}
                    disabled={!hasSelection}
                >
                    <Text className="text-white" style={{ fontWeight: '600', fontSize: 14 }}>
                        Start Import
                    </Text>
                </Pressable>
                <Pressable
                    onPress={onSelectFiles}
                    className="px-4 py-2.5 rounded-lg border border-muted-foreground"
                >
                    <Text className="text-foreground" style={{ fontSize: 14 }}>
                        Change Files
                    </Text>
                </Pressable>
            </View>
        </View>
    )
}

function MailboxWarning({ isVisible }: { isVisible: boolean }) {
    if (!isVisible) return null

    return (
        <Text className="text-danger" style={{ fontSize: 13 }}>
            Mail was found but you don't have a mailbox set up. Configure a mailbox in Mail settings first to import
            mail.
        </Text>
    )
}

function TakeoutImportingState({
    isVisible,
    activeServices,
    progress,
    onCancel,
    cancelRequested,
    fallbackActive,
}: {
    isVisible: boolean
    activeServices: ImportService[]
    progress: Record<ImportService, ImportProgress>
    onCancel: () => void
    cancelRequested: boolean
    fallbackActive: boolean
}) {
    if (!isVisible) return null

    return (
        <View className="gap-3">
            {fallbackActive ? (
                <Text className="text-xs text-muted-foreground text-center">
                    Background worker unavailable — importing in the foreground.
                </Text>
            ) : null}
            {activeServices.map((svc) => (
                <ServiceProgressCard key={svc} progress={progress[svc]} />
            ))}
            <TakeoutCancelButton onCancel={onCancel} cancelRequested={cancelRequested} />
        </View>
    )
}

function TakeoutCancelButton({
    onCancel,
    cancelRequested,
}: {
    onCancel: () => void
    cancelRequested: boolean
}) {
    const borderClass = cancelRequested ? 'border-muted-foreground' : 'border-danger'
    const textClass = cancelRequested ? 'text-muted-foreground' : 'text-danger'
    return (
        <Pressable
            onPress={onCancel}
            disabled={cancelRequested}
            className={`self-center px-4 py-2 rounded-lg mt-1 border ${borderClass}`}
            style={{ opacity: cancelRequested ? 0.5 : 1 }}
        >
            <Text className={textClass} style={{ fontSize: 13, fontWeight: '600' }}>
                {cancelRequested ? 'Canceling...' : 'Cancel Import'}
            </Text>
        </Pressable>
    )
}

function ServiceProgressCard({ progress: p }: { progress: ImportProgress }) {
    const foregroundColor = useThemeColor('foreground')
    const [showErrors, setShowErrors] = useState(false)

    const { label, Icon } = SERVICE_META[p.service]
    const total = p.total || 1
    const processed = p.imported + p.skipped + p.errors
    const pct = Math.min(100, Math.round((processed / total) * 100))
    const isDone = p.phase === 'done'

    return (
        <View className="gap-2 py-2">
            <View className="flex-row items-center gap-2">
                <Icon size={16} color={foregroundColor} />
                <Text className="text-foreground" style={{ fontSize: 14, fontWeight: '600', flex: 1 }}>
                    {label}
                </Text>
                <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
                    {isDone ? 'Done' : p.phase === 'scanning' ? 'Scanning...' : `${pct}%`}
                </Text>
            </View>

            <View className="h-1.5 rounded-full overflow-hidden bg-primary/20">
                <View className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </View>

            <View className="flex-row gap-4">
                <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
                    {p.imported} imported
                </Text>
                <SkippedCount isVisible={p.skipped > 0} count={p.skipped} />
                <ErrorCount isVisible={p.errors > 0} count={p.errors} />
            </View>

            <ErrorDetails
                isVisible={p.errorMessages.length > 0}
                messages={p.errorMessages}
                showErrors={showErrors}
                onToggle={() => setShowErrors((v) => !v)}
            />
        </View>
    )
}

function SkippedCount({ isVisible, count }: { isVisible: boolean; count: number }) {
    if (!isVisible) return null
    return (
        <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
            {count} skipped
        </Text>
    )
}

function ErrorCount({ isVisible, count }: { isVisible: boolean; count: number }) {
    if (!isVisible) return null
    return (
        <Text className="text-danger" style={{ fontSize: 12 }}>
            {count} errors
        </Text>
    )
}

function ErrorDetails({
    isVisible,
    messages,
    showErrors,
    onToggle,
}: {
    isVisible: boolean
    messages: string[]
    showErrors: boolean
    onToggle: () => void
}) {
    const mutedColor = useThemeColor('muted-foreground')

    if (!isVisible) return null

    return (
        <View>
            <Pressable onPress={onToggle} className="flex-row items-center gap-1">
                {showErrors ? <ChevronUp size={14} color={mutedColor} /> : <ChevronDown size={14} color={mutedColor} />}
                <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
                    {showErrors ? 'Hide errors' : 'Show errors'}
                </Text>
            </Pressable>
            {showErrors && (
                <View className="mt-1 gap-0.5">
                    {messages.slice(0, 20).map((msg) => (
                        <Text key={msg} className="text-danger" style={{ fontSize: 11 }}>
                            {msg}
                        </Text>
                    ))}
                    <RemainingErrors isVisible={messages.length > 20} count={messages.length - 20} />
                </View>
            )}
        </View>
    )
}

function RemainingErrors({ isVisible, count }: { isVisible: boolean; count: number }) {
    if (!isVisible) return null
    return (
        <Text className="text-muted-foreground" style={{ fontSize: 11 }}>
            ...and {count} more
        </Text>
    )
}

function TakeoutCompleteState({
    isVisible,
    activeServices,
    progress,
    onReset,
}: {
    isVisible: boolean
    activeServices: ImportService[]
    progress: Record<ImportService, ImportProgress>
    onReset: () => void
}) {
    const primaryColor = useThemeColor('primary')

    if (!isVisible) return null

    const totalImported = activeServices.reduce((sum, svc) => sum + progress[svc].imported, 0)
    const totalSkipped = activeServices.reduce((sum, svc) => sum + progress[svc].skipped, 0)
    const totalErrors = activeServices.reduce((sum, svc) => sum + progress[svc].errors, 0)

    return (
        <View className="gap-3 items-center py-4">
            <Check size={32} color={primaryColor} />
            <Text className="text-foreground" style={{ fontSize: 16, fontWeight: '600' }}>
                Import Complete
            </Text>
            <Text className="text-muted-foreground" style={{ fontSize: 13, textAlign: 'center' }}>
                {totalImported} records imported
                {totalSkipped > 0 ? `, ${totalSkipped} skipped` : ''}
                {totalErrors > 0 ? `, ${totalErrors} errors` : ''}
            </Text>
            <Pressable onPress={onReset} className="px-4 py-2.5 rounded-lg border border-muted-foreground mt-2">
                <Text className="text-foreground" style={{ fontSize: 14 }}>
                    Import More
                </Text>
            </Pressable>
        </View>
    )
}

function TakeoutErrorState({
    isVisible,
    error,
    onReset,
}: {
    isVisible: boolean
    error: string | null
    onReset: () => void
}) {
    const dangerColor = useThemeColor('danger')

    if (!isVisible) return null

    return (
        <View className="gap-3 items-center py-4">
            <AlertTriangle size={32} color={dangerColor} />
            <Text className="text-foreground" style={{ fontSize: 16, fontWeight: '600' }}>
                Import Failed
            </Text>
            <Text className="text-danger" style={{ fontSize: 13, textAlign: 'center' }}>
                {error || 'An unknown error occurred'}
            </Text>
            <Pressable onPress={onReset} className="px-4 py-2.5 rounded-lg border border-muted-foreground mt-2">
                <Text className="text-foreground" style={{ fontSize: 14 }}>
                    Try Again
                </Text>
            </Pressable>
        </View>
    )
}
