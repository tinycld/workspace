import { OverlayProvider } from '@gluestack-ui/core/overlay/creator'
import { ToastProvider } from '@gluestack-ui/core/toast/creator'
import type { ColorThemeSlug } from '@tinycld/core/lib/color-themes'
import { findColorTheme } from '@tinycld/core/lib/color-themes'
import type React from 'react'
import { useEffect } from 'react'
import { View, type ViewProps } from 'react-native'
import { Uniwind } from 'uniwind'

export type ModeType = 'light' | 'dark' | 'system'

export function GluestackUIProvider({
    mode = 'dark',
    colorTheme,
    ...props
}: {
    mode?: ModeType
    colorTheme?: string
    children?: React.ReactNode
    style?: ViewProps['style']
}) {
    useEffect(() => {
        Uniwind.setTheme(mode === 'system' ? 'system' : mode)
    }, [mode])

    useEffect(() => {
        if (!colorTheme) return
        const theme = findColorTheme(colorTheme as ColorThemeSlug)
        const resolvedMode = mode === 'system' ? 'light' : mode
        const vars = resolvedMode === 'dark' ? theme.dark : theme.light
        Uniwind.updateCSSVariables(resolvedMode, vars)
    }, [colorTheme, mode])

    return (
        <View style={[{ flex: 1, height: '100%', width: '100%' }, props.style]}>
            <OverlayProvider>
                <ToastProvider>{props.children}</ToastProvider>
            </OverlayProvider>
        </View>
    )
}
