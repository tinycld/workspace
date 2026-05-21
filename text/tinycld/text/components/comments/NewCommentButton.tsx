import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { MessageSquarePlus } from 'lucide-react-native'
import { Platform, Pressable } from 'react-native'

export interface NewCommentButtonProps {
    canStart: boolean
    isOpen: boolean
    onPress: () => void
}

// Toolbar button that starts a new comment thread. Presentational —
// the screen-level useNewCommentFlow hook owns the modal lifecycle and
// the mark-then-row flow, so the same trigger can be reached from the
// context menu's "Add comment" entry without duplicating state.
export function NewCommentButton({ canStart, isOpen, onPress }: NewCommentButtonProps) {
    const iconColor = useThemeColor('muted-foreground')
    const activeColor = useThemeColor('primary')

    const isDisabled = !canStart

    // ProseMirror loses its selection on focus blur, so the toolbar's
    // mousedown must be suppressed — without it the user's selection
    // would collapse to a caret before start() reads it.
    const webProps =
        Platform.OS === 'web'
            ? { onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() }
            : {}

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="New comment"
            accessibilityState={{ disabled: isDisabled }}
            disabled={isDisabled}
            onPress={onPress}
            {...webProps}
            className="rounded-md p-1.5"
            style={{ opacity: isDisabled ? 0.4 : 1 }}
            hitSlop={
                Platform.OS === 'web' ? undefined : { top: 6, bottom: 6, left: 4, right: 4 }
            }
        >
            <MessageSquarePlus size={16} color={isOpen ? activeColor : iconColor} />
        </Pressable>
    )
}
