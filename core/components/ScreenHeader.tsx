import type { ReactNode } from 'react'
import { Platform, View } from 'react-native'

interface ScreenHeaderProps {
    children: ReactNode
    isScrolled?: boolean
}

export function ScreenHeader({ children, isScrolled = false }: ScreenHeaderProps) {
    const webShadow =
        Platform.OS === 'web'
            ? ({
                  transition: 'box-shadow 0.2s ease',
                  boxShadow: isScrolled ? '0 1px 3px rgba(0, 0, 0, 0.08)' : 'none',
              } as Record<string, string>)
            : undefined

    return (
        <View
            className="border-b border-border bg-background z-[1] overflow-visible"
            style={webShadow}
        >
            {children}
        </View>
    )
}
