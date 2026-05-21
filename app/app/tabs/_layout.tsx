import { TabList, TabSlot, Tabs, TabTrigger } from 'expo-router/ui'
import { Pressable, Text } from 'react-native'

export default function TabsLayout() {
    return (
        <Tabs className="flex-1">
            <TabSlot />
            <TabList className="flex-row py-2 border-t border-border bg-surface-secondary">
                <TabTrigger name="home" href="/tabs" asChild>
                    <CustomTab>Home</CustomTab>
                </TabTrigger>
                <TabTrigger name="profile" href="/tabs/profile" asChild>
                    <CustomTab>Profile</CustomTab>
                </TabTrigger>
                <TabTrigger name="settings" href="/tabs/settings" asChild>
                    <CustomTab>Settings</CustomTab>
                </TabTrigger>
            </TabList>
        </Tabs>
    )
}

interface CustomTabProps {
    children: React.ReactNode
    isFocused?: boolean
    [key: string]: unknown
}

function CustomTab({ children, isFocused, ...props }: CustomTabProps) {
    return (
        <Pressable
            {...props}
            className={`flex-1 items-center justify-center py-3 ${isFocused ? 'border-b-2 border-primary' : ''}`}
        >
            <Text
                className={`text-sm ${isFocused ? 'font-semibold text-primary' : 'text-muted-foreground'}`}
            >
                {children}
            </Text>
        </Pressable>
    )
}
