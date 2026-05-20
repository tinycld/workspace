import { hexToRgba } from '@tinycld/core/lib/color-utils'
import { Text, View } from 'react-native'

interface LabelBadgeProps {
    name: string
    color: string
}

export function LabelBadge({ name, color }: LabelBadgeProps) {
    return (
        <View
            className="flex-row px-1.5 rounded border"
            style={{
                paddingVertical: 1,
                backgroundColor: hexToRgba(color, 0.2),
                borderColor: hexToRgba(color, 0.38),
            }}
        >
            <Text style={{ fontSize: 11, fontWeight: '500', color }}>{name}</Text>
        </View>
    )
}

interface LabelDotsProps {
    labels: { id: string; name: string; color: string }[]
    max?: number
}

export function LabelDots({ labels, max = 3 }: LabelDotsProps) {
    if (labels.length === 0) return null

    const visible = labels.slice(0, max)
    const overflow = labels.length - max

    return (
        <View className="flex-row items-center gap-[3px] shrink-0">
            {visible.map(label => (
                <View
                    key={label.id}
                    style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: label.color,
                    }}
                />
            ))}
            {overflow > 0 ? (
                <Text className="text-[11px] font-medium text-muted">+{overflow}</Text>
            ) : null}
        </View>
    )
}
