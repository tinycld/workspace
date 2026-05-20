export const script = (mode: string, colorTheme?: string) => {
    const documentElement = document.documentElement

    function getSystemColorMode() {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }

    try {
        const isSystem = mode === 'system'
        const theme = isSystem ? getSystemColorMode() : mode
        documentElement.classList.remove(theme === 'light' ? 'dark' : 'light')
        documentElement.classList.add(theme)
        documentElement.style.colorScheme = theme

        const existing = Array.from(documentElement.classList).filter(c => c.startsWith('theme-'))
        for (const cls of existing) {
            documentElement.classList.remove(cls)
        }
        if (colorTheme && colorTheme !== 'ocean-teal') {
            documentElement.classList.add(`theme-${colorTheme}`)
        }
    } catch (_e) {}
}
