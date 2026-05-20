import { Text, View } from 'react-native'

type StatusVariant = 'bundled' | 'installed' | 'available' | 'disabled' | 'installing'

const classNames: Record<StatusVariant, { bg: string; text: string }> = {
    bundled: { bg: 'bg-info', text: 'text-info-foreground' },
    installed: { bg: 'bg-success-soft', text: 'text-success-soft-foreground' },
    available: { bg: 'bg-muted', text: 'text-muted-foreground' },
    disabled: { bg: 'bg-danger-soft', text: 'text-danger-soft-foreground' },
    installing: { bg: 'bg-warning-soft', text: 'text-warning-soft-foreground' },
}

export function PackageStatusBadge({ status }: { status: string }) {
    const variant = classNames[status as StatusVariant] ?? classNames.available

    return (
        <View className={`px-2 py-0.5 rounded-full ${variant.bg}`}>
            <Text className={`text-[11px] font-semibold ${variant.text}`}>{status}</Text>
        </View>
    )
}
