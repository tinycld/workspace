import { Pressable, Text, View } from 'react-native'
import type { PivotError } from '../../lib/pivot'
import { bannerLinesFor } from './pivot-banner-lines'

// Banner shown above the grid when computePivot returns a PivotError.
// The grid binding (Task 14) decides when to mount this — the banner
// itself is purely presentational and takes the error + an onEdit
// callback that opens the pivot editor sidebar.
//
// Message wording lives in ./pivot-banner-lines (a pure .ts helper
// so unit tests can exercise it without dragging react-native into
// the test transform).
export interface PivotBannerProps {
    error: PivotError
    onEdit: () => void
}

export function PivotBanner({ error, onEdit }: PivotBannerProps) {
    const { title, body } = bannerLinesFor(error)
    return (
        <View
            accessibilityLabel="Pivot error"
            className="flex-row items-center justify-between bg-danger-soft px-4 py-3"
        >
            <View className="flex-1 pr-3">
                <Text className="text-sm font-medium text-danger">{title}</Text>
                <Text className="mt-1 text-xs text-danger">{body}</Text>
            </View>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit pivot"
                onPress={onEdit}
                className="rounded-md bg-danger px-3 py-2"
            >
                <Text className="text-xs font-medium text-background">Edit pivot</Text>
            </Pressable>
        </View>
    )
}
