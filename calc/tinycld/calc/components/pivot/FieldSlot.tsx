import type { ReactNode } from 'react'
import { Text, View } from 'react-native'

export interface FieldSlotProps {
    label: string
    children: ReactNode
}

export function FieldSlot({ label, children }: FieldSlotProps) {
    return (
        <View className="mt-3">
            <Text className="text-xs font-medium uppercase text-muted-foreground">
                {label}
            </Text>
            <View className="mt-1 gap-2">{children}</View>
        </View>
    )
}
