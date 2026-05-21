import { type Control, Controller } from '@tinycld/core/ui/form'
import { Pressable, Text, View } from 'react-native'
import type { PrintConfig } from '../../lib/print/types'

interface PrintScopeFieldsProps {
    control: Control<PrintConfig>
    sheets: Array<{ id: string; name: string }>
    selectionAvailable: boolean
}

// Sheet picker + range picker for the print dialog. The "current
// selection" radio auto-disables when the parent reports no usable
// selection (no selection at all, or selection on a different sheet
// than the one being printed).
export function PrintScopeFields({
    control,
    sheets,
    selectionAvailable,
}: PrintScopeFieldsProps) {
    return (
        <View style={{ gap: 12 }}>
            <View>
                <Text className="text-sm font-medium text-foreground mb-2">Sheets</Text>
                <Controller
                    control={control}
                    name="scope.sheets"
                    render={({ field }) => (
                        <View style={{ gap: 6 }}>
                            <RadioRow
                                label="Current sheet"
                                checked={field.value === 'current'}
                                onPress={() => field.onChange('current')}
                            />
                            <RadioRow
                                label="All sheets"
                                checked={field.value === 'all'}
                                onPress={() => field.onChange('all')}
                            />
                            <RadioRow
                                label={`Pick specific (${sheets.length})`}
                                checked={typeof field.value === 'object'}
                                onPress={() =>
                                    field.onChange({
                                        ids:
                                            typeof field.value === 'object'
                                                ? field.value.ids
                                                : sheets.length > 0
                                                  ? [sheets[0].id]
                                                  : [],
                                    })
                                }
                            />
                            {typeof field.value === 'object' ? (
                                <PickedSheetList
                                    pickedIds={field.value.ids}
                                    sheets={sheets}
                                    onChange={ids => field.onChange({ ids })}
                                />
                            ) : null}
                        </View>
                    )}
                />
            </View>
            <View>
                <Text className="text-sm font-medium text-foreground mb-2">Range</Text>
                <Controller
                    control={control}
                    name="scope.range"
                    render={({ field }) => (
                        <View style={{ gap: 6 }}>
                            <RadioRow
                                label="Used range"
                                checked={field.value === 'used'}
                                onPress={() => field.onChange('used')}
                            />
                            <RadioRow
                                label="Current selection"
                                checked={field.value === 'selection'}
                                disabled={!selectionAvailable}
                                onPress={() => field.onChange('selection')}
                            />
                        </View>
                    )}
                />
            </View>
        </View>
    )
}

interface RowProps {
    label: string
    checked: boolean
    disabled?: boolean
    onPress: () => void
}

function RadioRow({ label, checked, disabled, onPress }: RowProps) {
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ checked, disabled: !!disabled }}
            className={`flex-row items-center ${disabled ? 'opacity-50' : ''}`}
        >
            <View
                className={`w-4 h-4 rounded-full border ${
                    checked ? 'bg-primary border-primary' : 'border-border'
                }`}
            />
            <Text className="ml-2 text-sm text-foreground">{label}</Text>
        </Pressable>
    )
}

function CheckboxRow({ label, checked, onPress }: RowProps) {
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
            className="flex-row items-center"
        >
            <View
                className={`w-4 h-4 border ${
                    checked ? 'bg-primary border-primary' : 'border-border'
                }`}
            />
            <Text className="ml-2 text-sm text-foreground">{label}</Text>
        </Pressable>
    )
}

interface PickedSheetListProps {
    pickedIds: string[]
    sheets: Array<{ id: string; name: string }>
    onChange: (next: string[]) => void
}

// Lives outside the Controller render so the `pickedIds: string[]`
// narrowing is preserved across the per-sheet onPress closures. The
// outer Controller still owns the "Pick" branch — this component just
// renders the checkbox list once the parent has decided the picked
// shape is active.
function PickedSheetList({ pickedIds, sheets, onChange }: PickedSheetListProps) {
    return (
        <View style={{ paddingLeft: 24, gap: 4 }}>
            {sheets.map(s => {
                const checked = pickedIds.includes(s.id)
                return (
                    <CheckboxRow
                        key={s.id}
                        label={s.name}
                        checked={checked}
                        onPress={() =>
                            onChange(
                                checked
                                    ? pickedIds.filter(id => id !== s.id)
                                    : [...pickedIds, s.id]
                            )
                        }
                    />
                )
            })}
        </View>
    )
}
