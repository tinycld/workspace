import { View } from 'react-native'
import { useFindStore } from '../../hooks/find/use-find-store-context'

interface FindMatchOverlayProps {
    sheetId: string
    colOffsets: Float64Array
    rowOffsets: Float64Array
}

// Translucent yellow rectangles painted on every match cell on the
// current sheet. The current match gets a brighter shade so the user
// can spot the cursor without scrolling. Matches on other sheets (when
// scope='workbook') are present in the store but invisible here — the
// overlay only renders matches that belong to the active sheet.
export function FindMatchOverlay({ sheetId, colOffsets, rowOffsets }: FindMatchOverlayProps) {
    const matches = useFindStore(s => s.matches)
    const currentIndex = useFindStore(s => s.currentMatchIndex)
    const isOpen = useFindStore(s => s.isOpen)
    if (!isOpen || matches.length === 0) return null

    const overlays: React.ReactNode[] = []
    for (let i = 0; i < matches.length; i++) {
        const m = matches[i]
        if (m.sheetId !== sheetId) continue
        const left = colOffsets[m.col - 1] ?? 0
        const right = colOffsets[m.col] ?? left
        const width = right - left
        if (width <= 0) continue
        const top = rowOffsets[m.row - 1] ?? 0
        const bottom = rowOffsets[m.row] ?? top
        const height = bottom - top
        if (height <= 0) continue
        const isCurrent = i === currentIndex
        overlays.push(
            <View
                key={`${m.row}:${m.col}`}
                accessibilityLabel={
                    isCurrent ? 'Find current match' : 'Find match'
                }
                pointerEvents="none"
                style={{
                    position: 'absolute',
                    left,
                    top,
                    width,
                    height,
                    backgroundColor: isCurrent ? '#fde68a' : '#fef3c780',
                    borderWidth: isCurrent ? 2 : 1,
                    borderColor: isCurrent ? '#d97706' : '#fbbf24',
                }}
            />
        )
    }
    return <>{overlays}</>
}
