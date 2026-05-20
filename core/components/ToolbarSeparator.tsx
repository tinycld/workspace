import { View } from 'react-native'

interface ToolbarSeparatorProps {
    marginHorizontal?: number
}

export function ToolbarSeparator({ marginHorizontal = 4 }: ToolbarSeparatorProps) {
    return <View className="w-px h-5 bg-border" style={{ marginHorizontal }} />
}
