import { memo } from 'react'
import { View } from 'react-native'
import { useCommentsContext } from './CommentsContext'

interface CommentIndicatorProps {
    sheetId: string
    row: number
    col: number
}

// Tiny amber triangle in the cell's top-right corner. Drawn with two
// borderWidth tricks (no SVG, no asset). Skipped entirely when the cell
// has no unresolved threads — the early-return short-circuits 99% of
// cells without entering reconciliation.
//
// pointerEvents="none" so the cell's own press handler keeps working;
// opening the popover happens via the context menu / shortcut, which
// avoids any layering with the existing drag-select gestures.
export const CommentIndicator = memo(function CommentIndicator({
    sheetId,
    row,
    col,
}: CommentIndicatorProps) {
    const ctx = useCommentsContext()
    if (ctx == null) return null
    if (!ctx.hasUnresolved(sheetId, row, col)) return null
    return (
        <View
            pointerEvents="none"
            style={{
                position: 'absolute',
                top: 0,
                right: 0,
                width: 0,
                height: 0,
                borderTopWidth: 8,
                borderTopColor: '#F9A825',
                borderLeftWidth: 8,
                borderLeftColor: 'transparent',
            }}
            accessibilityLabel="Cell has comments"
        />
    )
})
