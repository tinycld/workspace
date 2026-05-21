import { View } from 'react-native'
import { HEADER_HEIGHT, ROW_HEADER_WIDTH } from './constants'

// Top-left corner stub. Renders nothing interactive — just fills the
// intersection of the column-header row and row-header column with
// the same surface color so the grid lines align cleanly.
export function CornerCell() {
    return (
        <View
            className="bg-surface-secondary border-r border-b border-border"
            style={{ width: ROW_HEADER_WIDTH, height: HEADER_HEIGHT }}
        />
    )
}
