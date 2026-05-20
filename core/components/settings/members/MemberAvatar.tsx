import { Text, View } from 'react-native'

const AVATAR_PALETTE = [
    ['#e0f2fe', '#0369a1'],
    ['#dcfce7', '#047857'],
    ['#fef3c7', '#b45309'],
    ['#fce7f3', '#be185d'],
    ['#ede9fe', '#6d28d9'],
    ['#ffedd5', '#c2410c'],
    ['#cffafe', '#0e7490'],
    ['#fee2e2', '#b91c1c'],
] as const

function hashKey(key: string): number {
    let h = 0
    for (let i = 0; i < key.length; i++) {
        h = (h << 5) - h + key.charCodeAt(i)
        h |= 0
    }
    return Math.abs(h)
}

function resolveInitials(name: string, email: string): string {
    const src = name.trim() || email.trim()
    if (!src) return '?'
    const parts = src.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
        const first = parts[0]?.[0] ?? ''
        const last = parts[parts.length - 1]?.[0] ?? ''
        return `${first}${last}`.toUpperCase()
    }
    const atIdx = src.indexOf('@')
    if (atIdx > 0) {
        const local = src.slice(0, atIdx)
        const localParts = local.split(/[._-]/).filter(Boolean)
        if (localParts.length >= 2) {
            const a = localParts[0]?.[0] ?? ''
            const b = localParts[1]?.[0] ?? ''
            return `${a}${b}`.toUpperCase()
        }
        return local.slice(0, 2).toUpperCase()
    }
    return src.slice(0, 2).toUpperCase()
}

interface Props {
    name: string
    email: string
    size?: number
    dimmed?: boolean
}

export function MemberAvatar({ name, email, size = 40, dimmed = false }: Props) {
    const key = (email || name).toLowerCase()
    const palette = AVATAR_PALETTE[hashKey(key) % AVATAR_PALETTE.length] ?? AVATAR_PALETTE[0]
    const [bg, fg] = palette
    const initials = resolveInitials(name, email)
    const fontSize = size * 0.36
    const radius = size * 0.32

    return (
        <View
            className="items-center justify-center"
            style={{
                width: size,
                height: size,
                borderRadius: radius,
                backgroundColor: bg,
                opacity: dimmed ? 0.55 : 1,
            }}
        >
            <Text
                style={{
                    color: fg,
                    fontWeight: '700',
                    fontSize,
                    letterSpacing: 0.2,
                    lineHeight: fontSize * 1.1,
                }}
            >
                {initials}
            </Text>
        </View>
    )
}
