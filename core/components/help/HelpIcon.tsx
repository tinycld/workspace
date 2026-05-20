import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { HelpCircle } from 'lucide-react-native'
import { Pressable } from 'react-native'
import { openHelp } from '../../lib/help/open-help'
import type { HelpTopicId } from '../../lib/help/types'

interface Props {
    topic: HelpTopicId
    size?: number
    tone?: 'muted' | 'foreground' | 'accent'
}

export function HelpIcon({ topic, size = 16, tone = 'muted' }: Props) {
    const colorToken =
        tone === 'foreground' ? 'foreground' : tone === 'accent' ? 'accent' : 'muted-foreground'
    const color = useThemeColor(colorToken)
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open help"
            hitSlop={8}
            onPress={() => openHelp(topic)}
        >
            <HelpCircle size={size} color={color} />
        </Pressable>
    )
}
