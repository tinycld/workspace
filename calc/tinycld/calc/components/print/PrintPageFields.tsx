import { type Control, Controller } from '@tinycld/core/ui/form'
import { Pressable, Text, View } from 'react-native'
import type {
    PrintConfig,
    PrintMargins,
    PrintOrientation,
    PrintScaling,
} from '../../lib/print/types'

interface PrintPageFieldsProps {
    control: Control<PrintConfig>
}

const ORIENTATIONS: Array<{ id: PrintOrientation; label: string }> = [
    { id: 'portrait', label: 'Portrait' },
    { id: 'landscape', label: 'Landscape' },
]

const SCALINGS: Array<{ id: PrintScaling; label: string }> = [
    { id: 'actual', label: 'Actual size' },
    { id: 'fit-width', label: 'Fit to width' },
    { id: 'fit-page', label: 'Fit to page' },
]

const MARGINS: Array<{ id: PrintMargins; label: string }> = [
    { id: 'normal', label: 'Normal' },
    { id: 'narrow', label: 'Narrow' },
    { id: 'wide', label: 'Wide' },
]

export function PrintPageFields({ control }: PrintPageFieldsProps) {
    return (
        <View style={{ gap: 12 }}>
            <SegmentField
                label="Orientation"
                control={control}
                name="page.orientation"
                options={ORIENTATIONS}
            />
            <SegmentField
                label="Scaling"
                control={control}
                name="page.scaling"
                options={SCALINGS}
            />
            <SegmentField
                label="Margins"
                control={control}
                name="page.margins"
                options={MARGINS}
            />
        </View>
    )
}

interface SegmentFieldProps<T extends string> {
    label: string
    control: Control<PrintConfig>
    name: 'page.orientation' | 'page.scaling' | 'page.margins'
    options: Array<{ id: T; label: string }>
}

function SegmentField<T extends string>({
    label,
    control,
    name,
    options,
}: SegmentFieldProps<T>) {
    return (
        <View>
            <Text className="text-sm font-medium text-foreground mb-2">{label}</Text>
            <Controller
                control={control}
                name={name}
                render={({ field }) => (
                    <View className="flex-row" style={{ gap: 6 }}>
                        {options.map(opt => {
                            const isSelected = field.value === opt.id
                            return (
                                <Pressable
                                    key={opt.id}
                                    onPress={() => field.onChange(opt.id)}
                                    className={`px-3 py-2 rounded-md border ${
                                        isSelected
                                            ? 'bg-primary border-primary'
                                            : 'bg-background border-border'
                                    }`}
                                >
                                    <Text
                                        className={`text-sm ${
                                            isSelected
                                                ? 'text-primary-foreground'
                                                : 'text-foreground'
                                        }`}
                                    >
                                        {opt.label}
                                    </Text>
                                </Pressable>
                            )
                        })}
                    </View>
                )}
            />
        </View>
    )
}
