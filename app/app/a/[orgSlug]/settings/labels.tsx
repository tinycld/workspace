import { LabelManagerPanel } from '@tinycld/core/components/LabelManagerDialog'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useNavigateBack } from '@tinycld/core/lib/use-navigate-back'
import { ArrowLeft, Tag } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'

export default function LabelsSettings() {
    const orgHref = useOrgHref()
    const navigateBack = useNavigateBack(() => orgHref('settings'))
    const fgColor = useThemeColor('foreground')

    return (
        <View className="flex-1 bg-background">
            <View className="flex-row gap-3 items-center p-5 pb-0">
                <Pressable onPress={navigateBack}>
                    <ArrowLeft size={24} color={fgColor} />
                </Pressable>
                <Tag size={24} color={fgColor} />
                <Text className="text-[22px] font-bold text-foreground">Labels</Text>
            </View>
            <View className="flex-1 p-4 max-w-[600px]">
                <Text className="mb-4 text-[13px] text-muted-foreground">
                    Manage labels for organizing items across your workspace.
                </Text>
                <LabelManagerPanel />
            </View>
        </View>
    )
}
