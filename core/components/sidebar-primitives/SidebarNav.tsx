import type { ReactNode } from 'react'
import { ScrollView, View } from 'react-native'

export function SidebarNav({ children }: { children: ReactNode }) {
    return (
        <View className="flex-1 bg-sidebar-background">
            <ScrollView
                className="flex-1"
                contentContainerStyle={{ padding: 8, gap: 2 }}
                showsVerticalScrollIndicator={false}
            >
                {children}
            </ScrollView>
        </View>
    )
}
