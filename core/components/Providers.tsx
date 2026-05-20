import '@tinycld/core/lib/crypto-polyfill'
import '@tinycld/core/file-viewer/register-default-previews'
import { QueryClientProvider } from '@tanstack/react-query'
import { CoreShortcuts } from '@tinycld/core/components/CoreShortcuts'
import { OfflineOverlay } from '@tinycld/core/components/OfflineOverlay'
import { ToastRenderer } from '@tinycld/core/components/Toast'
import { AuthProvider } from '@tinycld/core/lib/auth'
import { PBTSDBProvider, queryClient } from '@tinycld/core/lib/pocketbase'
import { ShortcutHelp, ShortcutsProvider } from '@tinycld/core/lib/shortcuts'
import { useColorTheme } from '@tinycld/core/lib/use-color-theme'
import { useConnectivityDetector } from '@tinycld/core/lib/use-connectivity-detector'
import { useThemePreference } from '@tinycld/core/lib/use-theme-preference'
import { GluestackUIProvider } from '@tinycld/core/ui/gluestack-ui-provider'
import type { ReactNode } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'

function ThemeAwareGluestackProvider({ children }: { children: ReactNode }) {
    const { preference } = useThemePreference()
    const { colorTheme } = useColorTheme()
    useConnectivityDetector()
    return (
        <GluestackUIProvider mode={preference} colorTheme={colorTheme}>
            {children}
            <ToastRenderer />
            <OfflineOverlay />
            <ShortcutHelp />
            <CoreShortcuts />
        </GluestackUIProvider>
    )
}

export function Providers({ children }: { children: ReactNode }) {
    return (
        <GestureHandlerRootView className="flex-1">
            <SafeAreaProvider>
                <QueryClientProvider client={queryClient}>
                    <PBTSDBProvider>
                        <AuthProvider>
                            <ShortcutsProvider>
                                <ThemeAwareGluestackProvider>
                                    {children}
                                </ThemeAwareGluestackProvider>
                            </ShortcutsProvider>
                        </AuthProvider>
                    </PBTSDBProvider>
                </QueryClientProvider>
            </SafeAreaProvider>
        </GestureHandlerRootView>
    )
}
