import type { ReactNode } from 'react'
import { Text, View } from 'react-native'

interface SidebarHeadingProps {
    children: string
    action?: ReactNode
}

export function SidebarHeading({ children, action }: SidebarHeadingProps) {
    const heading = (
        <Text className="text-[11px] font-bold uppercase tracking-wide px-3 pt-4 pb-1 text-muted">
            {children}
        </Text>
    )

    if (!action) return heading

    return (
        <View className="flex-row items-center justify-between pr-3">
            {heading}
            {action}
        </View>
    )
}
