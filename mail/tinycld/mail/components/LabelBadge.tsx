import { Text, View } from 'react-native'

interface LabelBadgeProps {
    name: string
    color: string
}

function hexToRgba(hex: string, alpha: number): string {
    const r = Number.parseInt(hex.slice(1, 3), 16)
    const g = Number.parseInt(hex.slice(3, 5), 16)
    const b = Number.parseInt(hex.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function LabelBadge({ name, color }: LabelBadgeProps) {
    const bgColor = hexToRgba(color, 0.12)
    const bdColor = hexToRgba(color, 0.25)

    return (
        <View
            className="px-1.5 py-[1px] rounded border"
            style={{
                backgroundColor: bgColor,
                borderColor: bdColor,
            }}
        >
            <Text style={{ fontSize: 11, fontWeight: '500', color }}>{name}</Text>
        </View>
    )
}
