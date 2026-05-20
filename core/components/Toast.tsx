import { type Toast as ToastType, useToastStore } from '@tinycld/core/lib/stores/toast-store'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { AlertTriangle, CheckCircle, Info, X, XCircle } from 'lucide-react-native'
import { useEffect, useRef } from 'react'
import { Animated, Platform, Pressable, Text, View } from 'react-native'

export function ToastRenderer() {
    const toasts = useToastStore(s => s.toasts)

    if (toasts.length === 0) return null

    return (
        <View
            style={{
                position: 'absolute',
                top: Platform.OS === 'web' ? 16 : 60,
                right: Platform.OS === 'web' ? 16 : 8,
                left: Platform.OS === 'web' ? undefined : 8,
                width: Platform.OS === 'web' ? 360 : undefined,
                zIndex: 10000,
                gap: 8,
            }}
            pointerEvents="box-none"
        >
            {toasts.map(toast => (
                <ToastCard key={toast.id} toast={toast} />
            ))}
        </View>
    )
}

const VARIANT_COLORS = {
    info: 'accent',
    success: 'primary',
    warning: 'warning',
    error: 'danger',
} as const

const VARIANT_ICONS = {
    info: Info,
    success: CheckCircle,
    warning: AlertTriangle,
    error: XCircle,
} as const

function ToastCard({ toast }: { toast: ToastType }) {
    const removeToast = useToastStore(s => s.removeToast)
    const bgColor = useThemeColor('surface-secondary')
    const borderColor = useThemeColor('border')
    const mutedColor = useThemeColor('muted-foreground')
    const variantColor = useThemeColor(VARIANT_COLORS[toast.variant])

    const opacity = useRef(new Animated.Value(0)).current
    const translateY = useRef(new Animated.Value(-20)).current

    useEffect(() => {
        Animated.parallel([
            Animated.timing(opacity, {
                toValue: 1,
                duration: 200,
                useNativeDriver: true,
            }),
            Animated.timing(translateY, {
                toValue: 0,
                duration: 200,
                useNativeDriver: true,
            }),
        ]).start()

        const timer = setTimeout(() => {
            Animated.timing(opacity, {
                toValue: 0,
                duration: 150,
                useNativeDriver: true,
            }).start(() => removeToast(toast.id))
        }, toast.duration)

        return () => clearTimeout(timer)
    }, [opacity, translateY, toast.id, toast.duration, removeToast])

    const Icon = VARIANT_ICONS[toast.variant]

    return (
        <Animated.View
            style={{
                opacity,
                transform: [{ translateY }],
                backgroundColor: bgColor,
                borderColor,
                borderWidth: 1,
                borderRadius: 12,
                padding: 14,
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: 10,
                ...(Platform.OS === 'web'
                    ? { boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }
                    : {
                          elevation: 6,
                          shadowColor: '#000',
                          shadowOffset: { width: 0, height: 4 },
                          shadowOpacity: 0.12,
                          shadowRadius: 12,
                      }),
            }}
        >
            <Icon size={18} color={variantColor} style={{ marginTop: 1 }} />

            <View style={{ flex: 1, gap: 2 }}>
                <Text className="text-sm font-semibold text-foreground">{toast.title}</Text>
                <ToastBody isVisible={!!toast.body} body={toast.body} color={mutedColor} />
                <ToastAction action={toast.action} color={variantColor} />
            </View>

            <Pressable onPress={() => removeToast(toast.id)} hitSlop={8}>
                <X size={16} color={mutedColor} />
            </Pressable>
        </Animated.View>
    )
}

function ToastBody({
    isVisible,
    body,
    color,
}: {
    isVisible: boolean
    body?: string
    color: string
}) {
    if (!isVisible) return null
    return <Text style={{ fontSize: 13, color }}>{body}</Text>
}

function ToastAction({
    action,
    color,
}: {
    action?: { label: string; onPress: () => void }
    color: string
}) {
    if (!action) return null
    return (
        <Pressable onPress={action.onPress} style={{ marginTop: 4 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color }}>{action.label}</Text>
        </Pressable>
    )
}
