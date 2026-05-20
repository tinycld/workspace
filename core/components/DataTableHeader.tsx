import { ScreenHeader } from '@tinycld/core/components/ScreenHeader'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ChevronDown, ChevronUp } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'

interface Column<F extends string = string> {
    label: string
    flex?: number
    width?: number
    /** When set, the header cell becomes clickable and reports this field via onSort. */
    sortField?: F
}

interface DataTableHeaderProps<F extends string = string> {
    columns: Column<F>[]
    /** Fixed-width spacer rendered before the column cells, to match a leading
     *  cell in the row (e.g. an avatar column) so the flex tracks align. */
    leadingWidth?: number
    trailing?: ReactNode
    sortField?: F
    sortDirection?: 'asc' | 'desc'
    onSort?: (field: F) => void
}

export function DataTableHeader<F extends string = string>({
    columns,
    leadingWidth,
    trailing,
    sortField,
    sortDirection,
    onSort,
}: DataTableHeaderProps<F>) {
    const fgColor = useThemeColor('foreground')

    return (
        <ScreenHeader>
            <View className="flex-row px-3 py-2">
                {leadingWidth ? <View style={{ width: leadingWidth }} /> : null}
                {columns.map((col, i) => {
                    const isSortable = col.sortField !== undefined && onSort !== undefined
                    const isActive = isSortable && sortField === col.sortField
                    const Chevron = sortDirection === 'desc' ? ChevronDown : ChevronUp

                    const labelText = (
                        <Text className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                            {col.label}
                        </Text>
                    )

                    if (!isSortable) {
                        return (
                            <View
                                key={col.label || `col-${i}`}
                                style={{ flex: col.flex, width: col.width }}
                            >
                                {labelText}
                            </View>
                        )
                    }

                    return (
                        <Pressable
                            key={col.label || `col-${i}`}
                            onPress={() => col.sortField && onSort(col.sortField)}
                            style={{ flex: col.flex, width: col.width }}
                            className="flex-row items-center gap-1"
                        >
                            {labelText}
                            {isActive ? <Chevron size={12} color={fgColor} /> : null}
                        </Pressable>
                    )
                })}
                {trailing}
            </View>
        </ScreenHeader>
    )
}
