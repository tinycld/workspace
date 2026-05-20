import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { GripVertical } from 'lucide-react-native'
import { useEffect, useRef } from 'react'
import { Platform, Pressable, View } from 'react-native'

interface DragHandleProps {
    drag: () => void
    disabled?: boolean
    color?: string
    size?: number
}

/**
 * React 19 removed the Responder Event Plugin from React DOM,
 * so Pressable's onPressIn no longer fires on web. This component
 * registers a native pointerdown listener on web to trigger drag.
 */
export function DragHandle({ drag, disabled, color, size = 18 }: DragHandleProps) {
    const mutedColor = useThemeColor('muted-foreground')
    const iconColor = color ?? mutedColor
    const ref = useRef<View>(null)
    const dragRef = useRef(drag)
    dragRef.current = drag

    useEffect(() => {
        if (Platform.OS !== 'web' || disabled) return
        const node = ref.current as unknown as HTMLElement | null
        if (!node) return

        const handler = () => {
            dragRef.current()
        }
        node.addEventListener('pointerdown', handler)
        return () => node.removeEventListener('pointerdown', handler)
    }, [disabled])

    if (Platform.OS === 'web') {
        return (
            <View ref={ref} className="pr-3" style={{ cursor: 'pointer' }}>
                <GripVertical size={size} color={iconColor} />
            </View>
        )
    }

    return (
        <Pressable onPressIn={drag} disabled={disabled} className="pr-3">
            <GripVertical size={size} color={iconColor} />
        </Pressable>
    )
}
