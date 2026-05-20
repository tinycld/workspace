import { formatKeys } from '@tinycld/core/lib/shortcuts/keys'
import { Text, View } from 'react-native'

interface KbdProps {
    keys: string
}

/**
 * Render a keyboard shortcut as one or more key badges. For sequences like
 * "g i", each atom is rendered as a separate badge; for combos like
 * "$mod+Enter", parts are joined with "+" inside a single badge.
 */
export function Kbd({ keys }: KbdProps) {
    const groups = formatKeys(keys)
    return (
        <View className="flex-row items-center gap-1">
            {groups.map((parts, atomIndex) => (
                <KbdBadge key={atomIndex} parts={parts} />
            ))}
        </View>
    )
}

function KbdBadge({ parts }: { parts: string[] }) {
    return (
        <View className="px-1.5 py-0.5 rounded border border-border bg-surface-secondary">
            <Text className="text-[11px] text-muted-foreground font-mono">{parts.join('+')}</Text>
        </View>
    )
}
