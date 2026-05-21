import { Pressable, Text, View } from 'react-native'

export interface FieldListProps {
    headers: readonly string[]
    onAddRow: (col: string) => void
    onAddCol: (col: string) => void
    onAddValue: (col: string) => void
    onAddFilter: (col: string) => void
    disabled?: boolean
}

export function FieldList({
    headers,
    onAddRow,
    onAddCol,
    onAddValue,
    onAddFilter,
    disabled,
}: FieldListProps) {
    return (
        <View className="rounded-md border border-border bg-background p-2">
            <Text className="text-xs font-medium uppercase text-muted-foreground">
                Available fields
            </Text>
            <View className="mt-2 gap-2">
                {headers.length === 0 && (
                    <Text className="text-xs text-muted-foreground">
                        No fields found in source range.
                    </Text>
                )}
                {headers.map((h, i) => (
                    <View
                        key={`${i}:${h}`}
                        className="flex-row items-center justify-between"
                    >
                        <Text className="flex-1 text-sm text-foreground">
                            {h || '(unnamed)'}
                        </Text>
                        <View className="flex-row gap-1">
                            {(['R', 'C', 'V', 'F'] as const).map((letter) => (
                                <Pressable
                                    key={letter}
                                    accessibilityLabel={`Add ${h} to ${letter}`}
                                    disabled={disabled || h === ''}
                                    onPress={() => {
                                        if (letter === 'R') onAddRow(h)
                                        else if (letter === 'C') onAddCol(h)
                                        else if (letter === 'V') onAddValue(h)
                                        else onAddFilter(h)
                                    }}
                                    className="rounded-md border border-border bg-surface-secondary px-2 py-1"
                                >
                                    <Text className="text-xs text-foreground">
                                        {letter}
                                    </Text>
                                </Pressable>
                            ))}
                        </View>
                    </View>
                ))}
            </View>
        </View>
    )
}
