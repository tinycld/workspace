import { PB_SERVER_ADDR } from '@tinycld/core/lib/config'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Check, CircleAlert, Loader2 } from 'lucide-react-native'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'

interface ProgressStep {
    step: string
    progress: number
    message: string
}

interface InstallProgressModalProps {
    isVisible: boolean
    jobId: string | null
    authToken: string
    onClose: () => void
    onComplete: () => void
}

export function InstallProgressModal({
    isVisible,
    jobId,
    authToken,
    onClose,
    onComplete,
}: InstallProgressModalProps) {
    const fgColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted-foreground')
    const successColor = useThemeColor('success')
    const dangerColor = useThemeColor('danger')

    const [steps, setSteps] = useState<ProgressStep[]>([])
    const [status, setStatus] = useState<'running' | 'success' | 'failed'>('running')
    const [error, setError] = useState<string | null>(null)
    const scrollRef = useRef<ScrollView>(null)

    const handleSSE = useCallback(() => {
        if (!jobId) return

        const url = `${PB_SERVER_ADDR}/api/admin/packages/events/${jobId}?token=${encodeURIComponent(authToken)}`
        const eventSource = new EventSource(url)

        eventSource.addEventListener('progress', (event: MessageEvent) => {
            const data = JSON.parse(event.data) as ProgressStep
            setSteps(prev => [...prev, data])
        })

        eventSource.addEventListener('complete', (event: MessageEvent) => {
            const data = JSON.parse(event.data) as { status: string; error?: string }
            setStatus(data.status === 'success' ? 'success' : 'failed')
            if (data.error) setError(data.error)
            eventSource.close()
            if (data.status === 'success') onComplete()
        })

        eventSource.addEventListener('error', () => {
            eventSource.close()
        })

        return () => eventSource.close()
    }, [jobId, authToken, onComplete])

    useEffect(() => {
        if (!isVisible || !jobId) return
        setSteps([])
        setStatus('running')
        setError(null)
        return handleSSE()
    }, [isVisible, jobId, handleSSE])

    // biome-ignore lint/correctness/useExhaustiveDependencies: `steps.length` is the intentional trigger — auto-scroll to the bottom whenever a new progress step arrives
    useEffect(() => {
        scrollRef.current?.scrollToEnd({ animated: true })
    }, [steps.length])

    if (!isVisible) return null

    const latestStep = steps[steps.length - 1]
    const progress = latestStep?.progress ?? 0

    return (
        <View className="rounded-xl border border-border bg-surface-secondary overflow-hidden">
            <View className="p-4 gap-4">
                <View className="flex-row justify-between items-center">
                    <Text className="text-base font-semibold text-foreground">
                        {status === 'running'
                            ? 'Installing Package...'
                            : status === 'success'
                              ? 'Installation Complete'
                              : 'Installation Failed'}
                    </Text>
                    <StatusIcon
                        status={status}
                        successColor={successColor}
                        dangerColor={dangerColor}
                        mutedColor={mutedColor}
                    />
                </View>

                <ProgressBar
                    progress={progress}
                    status={status}
                    successColor={successColor}
                    dangerColor={dangerColor}
                />

                <ScrollView
                    ref={scrollRef}
                    className="rounded-lg border border-border bg-surface-secondary"
                    style={{ maxHeight: 300 }}
                >
                    <View className="p-3 gap-1">
                        {steps.map((step, i) => (
                            <StepLine
                                key={`${step.progress}-${step.step}`}
                                step={step}
                                isLatest={i === steps.length - 1}
                                status={status}
                                fgColor={fgColor}
                                mutedColor={mutedColor}
                                successColor={successColor}
                                dangerColor={dangerColor}
                            />
                        ))}
                    </View>
                </ScrollView>

                <ErrorDisplay error={error} />

                <CloseButton isVisible={status !== 'running'} onPress={onClose} />
            </View>
        </View>
    )
}

function StatusIcon({
    status,
    successColor,
    dangerColor,
    mutedColor,
}: {
    status: string
    successColor: string
    dangerColor: string
    mutedColor: string
}) {
    if (status === 'success') return <Check size={20} color={successColor} />
    if (status === 'failed') return <CircleAlert size={20} color={dangerColor} />
    return <Loader2 size={20} color={mutedColor} />
}

function ProgressBar({
    progress,
    status,
    successColor,
    dangerColor,
}: {
    progress: number
    status: string
    successColor: string
    dangerColor: string
}) {
    const barColor = status === 'failed' ? dangerColor : successColor

    return (
        <View className="h-2 rounded-full bg-border overflow-hidden">
            <View
                className="h-full rounded-full"
                style={{
                    width: `${progress}%`,
                    backgroundColor: barColor,
                }}
            />
        </View>
    )
}

function StepLine({
    step,
    isLatest,
    status,
    fgColor,
    mutedColor,
    successColor,
    dangerColor,
}: {
    step: ProgressStep
    isLatest: boolean
    status: string
    fgColor: string
    mutedColor: string
    successColor: string
    dangerColor: string
}) {
    const isActive = isLatest && status === 'running'
    const isFailed = step.message.startsWith('FAILED')
    const color = isActive ? fgColor : isFailed ? dangerColor : mutedColor

    return (
        <View className="flex-row gap-2 items-start">
            <Text
                className="text-[11px] text-muted-foreground"
                style={{ fontVariant: ['tabular-nums'], minWidth: 32 }}
            >
                {step.progress}%
            </Text>
            <View className="mt-1.5">
                {isActive ? (
                    <Loader2 size={10} color={fgColor} />
                ) : (
                    <Check size={10} color={successColor} />
                )}
            </View>
            <Text className="text-xs flex-1" style={{ color }}>
                {step.message}
            </Text>
        </View>
    )
}

function ErrorDisplay({ error }: { error: string | null }) {
    if (!error) return null
    return (
        <View className="rounded-lg p-3 bg-danger-soft">
            <Text className="text-[13px] text-danger">{error}</Text>
        </View>
    )
}

function CloseButton({ isVisible, onPress }: { isVisible: boolean; onPress: () => void }) {
    if (!isVisible) return null
    return (
        <Pressable onPress={onPress} className="self-end px-3 py-2 rounded-lg bg-border">
            <Text className="text-[13px] font-semibold text-muted-foreground">Close</Text>
        </Pressable>
    )
}
