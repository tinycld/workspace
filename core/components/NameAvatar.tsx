import { Text, View } from 'react-native'

const AVATAR_COLORS = [
    '#3b82f6',
    '#22c55e',
    '#a855f7',
    '#f97316',
    '#ec4899',
    '#ef4444',
    '#eab308',
    '#06b6d4',
]

function hashName(name: string): number {
    let hash = 0
    for (let i = 0; i < name.length; i++) {
        hash = (hash << 5) - hash + name.charCodeAt(i)
        hash |= 0
    }
    return Math.abs(hash)
}

interface NameAvatarProps {
    firstName: string
    lastName?: string
    size?: number
}

export function NameAvatar({ firstName, lastName, size = 40 }: NameAvatarProps) {
    const fullName = `${firstName} ${lastName ?? ''}`.trim()
    const backgroundColor = AVATAR_COLORS[hashName(fullName) % AVATAR_COLORS.length]
    const letter = (firstName[0] ?? '?').toUpperCase()
    const fontSize = size * 0.42

    return (
        <View
            className="items-center justify-center"
            style={{
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor,
            }}
        >
            <Text
                className="text-center"
                style={{
                    color: '#fff',
                    fontWeight: '600',
                    fontSize,
                    lineHeight: size,
                }}
            >
                {letter}
            </Text>
        </View>
    )
}
