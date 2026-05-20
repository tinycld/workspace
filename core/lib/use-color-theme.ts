import { type ColorThemeSlug, DEFAULT_COLOR_THEME } from '@tinycld/core/lib/color-themes'
import { useUserPreference } from '@tinycld/core/lib/use-user-preference'

export function useColorTheme() {
    const [colorTheme, setColorTheme] = useUserPreference<ColorThemeSlug>(
        'core',
        'color_theme',
        DEFAULT_COLOR_THEME
    )
    return { colorTheme, setColorTheme }
}
