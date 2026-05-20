import AsyncStorage from '@react-native-async-storage/async-storage'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import type { LucideIcon } from 'lucide-react-native'
import { type ReactNode, useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'

/**
 * Headline + body shell for one-shot first-run education modals.
 *
 * Persists a "shown" marker under `firstRun:{storageKey}` in AsyncStorage so
 * a given user only sees a modal once per device. Callers compose the
 * surrounding gating predicate (e.g. "fire when user is demo AND on /a/demo")
 * — this component only handles the dismiss-and-remember side. Two callers
 * exist today (DemoIntroModal, planned WelcomeModal); copy is provided per
 * caller, layout/style is shared.
 *
 * Pass `enabled={false}` to suppress the modal entirely (e.g. while auth is
 * still loading) — it'll wait for the gate to flip true before ever showing
 * itself, so we don't flash unrelated modals during the boot sequence.
 */
export interface FirstRunModalProps {
    /**
     * Stable per-modal key. The full AsyncStorage key is namespaced
     * (`firstRun:` prefix) so callers don't collide with unrelated state.
     */
    storageKey: string
    /** Predicate gating whether the modal should consider showing. */
    enabled: boolean
    icon: LucideIcon
    /** Tone of the icon + accent edge. Maps to a useThemeColor token. */
    accentToken?: 'primary' | 'warning' | 'success'
    title: string
    /**
     * Single short paragraph below the title — keep under ~140 chars. Optional;
     * omit when the body slot itself frames the modal (e.g. a form).
     */
    intro?: string
    /** Body slot — typically a list of <FirstRunModalBullet /> children. */
    children?: ReactNode
    primaryLabel: string
    /**
     * Primary button handler. Returning `false` aborts dismissal — the modal
     * stays open and the storage marker is not written. Useful when the body
     * slot owns validation that should keep the modal open on failure.
     * Default (return undefined or `true`) preserves dismiss-on-press.
     */
    onPrimary: () => boolean | undefined
    /**
     * Optional secondary action. When omitted, the modal renders the primary
     * button alone — useful for "got it" confirmations where there's nothing
     * meaningful to choose between.
     */
    secondaryLabel?: string
    onSecondary?: () => void
}

const STORAGE_NAMESPACE = 'firstRun:'

export function FirstRunModal({
    storageKey,
    enabled,
    icon: Icon,
    accentToken = 'primary',
    title,
    intro,
    children,
    primaryLabel,
    onPrimary,
    secondaryLabel,
    onSecondary,
}: FirstRunModalProps) {
    const [phase, setPhase] = useState<'pending' | 'show' | 'hide'>('pending')

    const backdrop = useThemeColor('overlay-backdrop')
    const accent = useThemeColor(accentToken)
    const accentFg = useThemeColor(`${accentToken}-foreground` as 'primary-foreground')

    useEffect(() => {
        if (!enabled) return
        let cancelled = false
        AsyncStorage.getItem(STORAGE_NAMESPACE + storageKey)
            .then(value => {
                if (cancelled) return
                setPhase(value === '1' ? 'hide' : 'show')
            })
            .catch(() => {
                // Storage failures default to "don't show": worst case the
                // user misses an intro modal, which is recoverable; the
                // alternative (showing every visit) is more annoying.
                if (!cancelled) setPhase('hide')
            })
        return () => {
            cancelled = true
        }
    }, [enabled, storageKey])

    if (phase !== 'show') return null

    const dismiss = (action: 'primary' | 'secondary') => {
        if (action === 'primary') {
            // Run the callback first so it can abort dismissal by returning
            // false. Lets callers gate dismissal on body-slot validation
            // (e.g. a form rejecting a malformed email).
            const result = onPrimary()
            if (result === false) return
        } else if (onSecondary) {
            onSecondary()
        }

        AsyncStorage.setItem(STORAGE_NAMESPACE + storageKey, '1').catch(() => {
            // If we can't persist the marker the modal will reappear next
            // boot. Annoying but not broken; nothing to do at the call site.
        })
        setPhase('hide')
    }

    return (
        <View
            className="absolute top-0 left-0 right-0 bottom-0 justify-center items-center z-[250] p-6"
            style={{ backgroundColor: backdrop }}
        >
            <View
                className="max-w-full border border-border bg-background rounded-[20px] overflow-hidden"
                style={{
                    width: 460,
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 12 },
                    shadowOpacity: 0.2,
                    shadowRadius: 32,
                    elevation: 12,
                }}
            >
                {/* Accent edge along the top — same role as the SVG draw-on
                    in the marketing CTA: a small cue that this surface is
                    distinct from the rest of the chrome. */}
                <View className="h-[3px]" style={{ backgroundColor: accent }} />

                <View className="p-7">
                    <View
                        className="w-11 h-11 rounded-xl items-center justify-center mb-[18px]"
                        style={{ backgroundColor: accent }}
                    >
                        <Icon size={22} color={accentFg} />
                    </View>

                    <Text
                        className={`text-[22px] font-bold text-foreground ${intro ? 'mb-2' : children ? 'mb-5' : 'mb-6'}`}
                    >
                        {title}
                    </Text>
                    {intro ? (
                        <Text
                            className={`text-sm leading-5 text-muted-foreground ${children ? 'mb-5' : 'mb-6'}`}
                        >
                            {intro}
                        </Text>
                    ) : null}

                    {children ? <View className="gap-3 mb-6">{children}</View> : null}

                    <View className="flex-row gap-2.5 justify-end">
                        {secondaryLabel ? (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={secondaryLabel}
                                onPress={() => dismiss('secondary')}
                                className="py-2.5 px-4 rounded-[10px]"
                            >
                                <Text className="text-sm font-semibold text-muted-foreground">
                                    {secondaryLabel}
                                </Text>
                            </Pressable>
                        ) : null}
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={primaryLabel}
                            onPress={() => dismiss('primary')}
                            className="py-2.5 px-[18px] rounded-[10px]"
                            style={{ backgroundColor: accent }}
                        >
                            <Text className="text-sm font-bold" style={{ color: accentFg }}>
                                {primaryLabel}
                            </Text>
                        </Pressable>
                    </View>
                </View>
            </View>
        </View>
    )
}

/**
 * One-line bullet for the modal body. A leading dot + a heading + a thin
 * subtitle on the next line. Designed to read as a punchy list at a glance —
 * three of these is the sweet spot.
 */
export interface FirstRunModalBulletProps {
    label: string
    detail: string
}

export function FirstRunModalBullet({ label, detail }: FirstRunModalBulletProps) {
    return (
        <View className="flex-row items-start gap-2.5">
            <View className="w-1.5 h-1.5 rounded-full mt-[7px] bg-primary" />
            <View className="flex-1">
                <Text className="text-sm font-semibold text-foreground mb-px">{label}</Text>
                <Text className="text-[13px] leading-[18px] text-muted-foreground">{detail}</Text>
            </View>
        </View>
    )
}
