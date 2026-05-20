import { DEFAULT_COLOR_THEME } from '@tinycld/core/lib/color-themes'
import { GluestackUIProvider } from '@tinycld/core/ui/gluestack-ui-provider'
import type { ReactNode } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'

// Provider stack for screens that must render before a server address is
// resolved (e.g. the /connect onboarding screen). Skips PBTSDB / Auth /
// Shortcuts because those depend on PB_SERVER_ADDR; falls back to static
// theme defaults instead of useThemePreference + useColorTheme, both of
// which require PocketBase.
export function MinimalProviders({ children }: { children: ReactNode }) {
    return (
        <GestureHandlerRootView className="flex-1">
            <SafeAreaProvider>
                <GluestackUIProvider mode="system" colorTheme={DEFAULT_COLOR_THEME}>
                    {children}
                </GluestackUIProvider>
            </SafeAreaProvider>
        </GestureHandlerRootView>
    )
}
