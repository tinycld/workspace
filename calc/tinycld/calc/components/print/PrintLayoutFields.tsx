import { type Control, Controller, NumberInput, Toggle } from '@tinycld/core/ui/form'
import { Pressable, Text, View } from 'react-native'
import type { PrintConfig } from '../../lib/print/types'

interface PrintLayoutFieldsProps {
    control: Control<PrintConfig>
}

// Header / gridline / repeat-row toggles. The repeat-row range is null
// when disabled and {from, to} when enabled — Controller lets us flip
// between the two shapes from one toggle. The from/to NumberInputs are
// only rendered when the range is non-null.
export function PrintLayoutFields({ control }: PrintLayoutFieldsProps) {
    return (
        <View style={{ gap: 12 }}>
            <Toggle
                control={control}
                name="layout.showHeaders"
                label="Show row/column headers (A,B,C / 1,2,3)"
            />
            <Toggle
                control={control}
                name="layout.showGridlines"
                label="Show gridlines"
            />
            <Controller
                control={control}
                name="layout.repeatRows"
                render={({ field }) => {
                    const enabled = field.value != null
                    return (
                        <View>
                            <Pressable
                                onPress={() =>
                                    field.onChange(enabled ? null : { from: 1, to: 1 })
                                }
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: enabled }}
                                className="flex-row items-center"
                            >
                                <View
                                    className={`w-4 h-4 border ${
                                        enabled ? 'bg-primary border-primary' : 'border-border'
                                    }`}
                                />
                                <Text className="ml-2 text-sm font-medium text-foreground">
                                    Repeat rows on every page
                                </Text>
                            </Pressable>
                            {enabled ? (
                                <View
                                    className="flex-row items-center"
                                    style={{ gap: 8, marginTop: 6 }}
                                >
                                    <Text className="text-sm text-foreground">From row</Text>
                                    <View style={{ width: 96 }}>
                                        <NumberInput
                                            control={control}
                                            name="layout.repeatRows.from"
                                            min={1}
                                        />
                                    </View>
                                    <Text className="text-sm text-foreground">To row</Text>
                                    <View style={{ width: 96 }}>
                                        <NumberInput
                                            control={control}
                                            name="layout.repeatRows.to"
                                            min={1}
                                        />
                                    </View>
                                </View>
                            ) : null}
                        </View>
                    )
                }}
            />
        </View>
    )
}
