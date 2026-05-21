import { X } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import {
    filterSummaryLabel,
    filterValueLabel,
    shouldShowAllToggle,
    showAllToggleLabel,
    toggleFilterSelection,
    visibleFilterValues,
} from './field-row-helpers'

// Field chip for the Filters slot. Unlike Rows/Cols/Values there's no
// reorder UI — filter ordering doesn't change the computed pivot, so
// we only render a remove button alongside a multi-select of distinct
// source values.
//
// `distinctValues` comes from the source-read pass (Task 5's
// readDistinctValues); the caller is responsible for piping that in
// based on the current source range. We don't read pbtsdb / Y.Doc
// here because the row is also rendered in tests/storybook where the
// real source isn't mounted.
//
// `selected` is the array stored in PivotDefinition.filterSelections
// for this column. Empty array = "all values" (no filtering); any
// non-empty subset is a whitelist. The toggle helper lives in
// field-row-helpers so the set logic is exercisable without RN.
//
// Local `showAll` state is the one legitimate useState here — it's
// purely transient UI state ("did the user expand the long list?")
// that nothing else in the app cares about. CLAUDE.md allows local
// useState for that case.
export interface FilterFieldRowProps {
    column: string
    selected: readonly string[]
    distinctValues: readonly string[]
    onChangeSelection: (next: readonly string[]) => void
    onRemove: () => void
    disabled?: boolean
}

export function FilterFieldRow({
    column,
    selected,
    distinctValues,
    onChangeSelection,
    onRemove,
    disabled,
}: FilterFieldRowProps) {
    const iconColor = useThemeColor('muted-foreground')
    const [showAll, setShowAll] = useState(false)
    const visible = visibleFilterValues(distinctValues, showAll)
    const selectedSet = new Set(selected)
    const showToggle = shouldShowAllToggle(distinctValues)

    const toggle = (value: string) => {
        onChangeSelection(toggleFilterSelection(selected, value))
    }

    return (
        <View className="rounded-md border border-border bg-surface-secondary p-2">
            <View className="flex-row items-center justify-between">
                <Text className="flex-1 text-sm text-foreground">{column}</Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Remove filter"
                    disabled={disabled}
                    onPress={onRemove}
                    className="rounded-md p-1"
                >
                    <X size={14} color={iconColor} />
                </Pressable>
            </View>
            <Text className="mt-1 text-xs text-muted-foreground">
                {filterSummaryLabel(selected)}
            </Text>
            <View className="mt-2 flex-row flex-wrap gap-1">
                {visible.map((v, i) => (
                    <FilterValueChip
                        key={`${i}:${v}`}
                        value={v}
                        active={selectedSet.has(v)}
                        disabled={disabled}
                        onPress={toggle}
                    />
                ))}
                {showToggle && (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Show all values"
                        onPress={() => setShowAll((s) => !s)}
                        className="rounded-md border border-border px-2 py-1"
                    >
                        <Text className="text-xs text-muted-foreground">
                            {showAllToggleLabel(showAll, distinctValues.length)}
                        </Text>
                    </Pressable>
                )}
            </View>
        </View>
    )
}

interface FilterValueChipProps {
    value: string
    active: boolean
    disabled: boolean | undefined
    onPress: (value: string) => void
}

function FilterValueChip({
    value,
    active,
    disabled,
    onPress,
}: FilterValueChipProps) {
    const containerClass = active
        ? 'rounded-md px-2 py-1 bg-accent'
        : 'rounded-md px-2 py-1 bg-background border border-border'
    const textClass = active
        ? 'text-xs text-accent-foreground'
        : 'text-xs text-foreground'
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Toggle ${value}`}
            disabled={disabled}
            onPress={() => onPress(value)}
            className={containerClass}
        >
            <Text className={textClass}>{filterValueLabel(value)}</Text>
        </Pressable>
    )
}
