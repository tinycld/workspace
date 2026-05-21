import { Pressable, Text, View } from 'react-native'

// Surfaced by PivotGrid when the underlying PivotDefinition has no
// row / column / value fields configured yet — i.e. the user just
// created a pivot and hasn't dragged anything in. The CTA opens the
// side-panel editor (wired up in Task 17).
export interface PivotEmptyStateProps {
    onOpenSidePanel: () => void
}

export function PivotEmptyState({ onOpenSidePanel }: PivotEmptyStateProps) {
    return (
        <View className="flex-1 items-center justify-center bg-background px-8">
            <View className="max-w-[420px] items-center rounded-xl border border-border bg-surface-secondary p-8">
                <Text className="text-base font-medium text-foreground">
                    Configure your pivot
                </Text>
                <Text className="mt-2 text-center text-sm text-muted-foreground">
                    Drag fields from the side panel into Rows, Columns, Values,
                    or Filters to build your pivot.
                </Text>
                <Pressable
                    accessibilityRole="button"
                    onPress={onOpenSidePanel}
                    className="mt-4 rounded-md bg-accent px-4 py-2"
                >
                    <Text className="text-sm font-medium text-accent-foreground">
                        Open pivot editor
                    </Text>
                </Pressable>
            </View>
        </View>
    )
}
