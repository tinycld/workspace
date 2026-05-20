import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Star } from 'lucide-react-native'

interface StarIconProps {
    isStarred: boolean
    size?: number
}

const STARRED_COLOR = '#facc15'

export function StarIcon({ isStarred, size = 16 }: StarIconProps) {
    const mutedColor = useThemeColor('muted-foreground')

    return (
        <Star
            size={size}
            color={isStarred ? STARRED_COLOR : mutedColor}
            fill={isStarred ? STARRED_COLOR : 'transparent'}
        />
    )
}
