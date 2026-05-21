import { ChevronDown, ChevronUp, X } from 'lucide-react-native'
import { Pressable, Text, TextInput, View } from 'react-native'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import type {
    PivotAggregation,
    PivotValueField,
} from '../../lib/workbook-types'
import { PIVOT_AGGREGATIONS } from './field-row-helpers'

// Field chip for the Values slot. Wraps the same move/remove header as
// FieldRow but adds two extra controls: an aggregation picker (chip
// row, single-select) and a numFmt text field. The aggregation list
// lives in field-row-helpers.ts so the canonical order is in lockstep
// with the PivotAggregation union and the y-binding's VALID_AGGS set.
//
// Why chips instead of a Menu/Select: there are only 11 aggregations
// and they all fit two rows of small chips, so showing them all keeps
// the picker discoverable and one tap away. A Menu would add an extra
// portal layer and an extra tap for a list that's never going to grow.
//
// Why a plain TextInput for numFmt: numfmt codes are free-form strings
// (e.g. "#,##0.00", "0.0%", "[$$-en-US]#,##0.00") so a multi-select or
// canned list would mislead. The placeholder shows "(default)" so the
// empty state reads as intentional rather than missing.
export interface ValueFieldRowProps {
    field: PivotValueField
    canMoveUp: boolean
    canMoveDown: boolean
    onMoveUp: () => void
    onMoveDown: () => void
    onRemove: () => void
    onChangeAggregation: (agg: PivotAggregation) => void
    onChangeNumFmt: (numFmt: string) => void
    disabled?: boolean
}

export function ValueFieldRow({
    field,
    canMoveUp,
    canMoveDown,
    onMoveUp,
    onMoveDown,
    onRemove,
    onChangeAggregation,
    onChangeNumFmt,
    disabled,
}: ValueFieldRowProps) {
    const iconColor = useThemeColor('muted-foreground')
    return (
        <View className="rounded-md border border-border bg-surface-secondary p-2">
            <View className="flex-row items-center justify-between">
                <Text className="flex-1 text-sm text-foreground">
                    {field.sourceColumn}
                </Text>
                <View className="flex-row items-center gap-1">
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Move up"
                        disabled={disabled || !canMoveUp}
                        onPress={onMoveUp}
                        className="rounded-md p-1"
                    >
                        <ChevronUp size={14} color={iconColor} />
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Move down"
                        disabled={disabled || !canMoveDown}
                        onPress={onMoveDown}
                        className="rounded-md p-1"
                    >
                        <ChevronDown size={14} color={iconColor} />
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Remove field"
                        disabled={disabled}
                        onPress={onRemove}
                        className="rounded-md p-1"
                    >
                        <X size={14} color={iconColor} />
                    </Pressable>
                </View>
            </View>
            <View className="mt-2 flex-row flex-wrap gap-1">
                {PIVOT_AGGREGATIONS.map((agg) => (
                    <AggregationChip
                        key={agg}
                        agg={agg}
                        active={field.aggregation === agg}
                        disabled={disabled}
                        onPress={onChangeAggregation}
                    />
                ))}
            </View>
            <View className="mt-2">
                <Text className="text-xs text-muted-foreground">
                    Number format
                </Text>
                <TextInput
                    accessibilityLabel="Number format"
                    editable={!disabled}
                    value={field.numFmt ?? ''}
                    placeholder="(default)"
                    onChangeText={onChangeNumFmt}
                    className="mt-1 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                />
            </View>
        </View>
    )
}

interface AggregationChipProps {
    agg: PivotAggregation
    active: boolean
    disabled: boolean | undefined
    onPress: (agg: PivotAggregation) => void
}

function AggregationChip({
    agg,
    active,
    disabled,
    onPress,
}: AggregationChipProps) {
    const containerClass = active
        ? 'rounded-md px-2 py-1 bg-accent'
        : 'rounded-md px-2 py-1 bg-background border border-border'
    const textClass = active
        ? 'text-xs text-accent-foreground'
        : 'text-xs text-foreground'
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Use ${agg}`}
            disabled={disabled}
            onPress={() => onPress(agg)}
            className={containerClass}
        >
            <Text className={textClass}>{agg}</Text>
        </Pressable>
    )
}
