export type ColorThemeSlug =
    | 'ocean-teal'
    | 'coral-sunset'
    | 'arctic-blue'
    | 'golden-hour'
    | 'forest'
    | 'lavender-haze'

export type ColorThemeVars = {
    [key: string]: string
    '--primary': string
    '--primary-foreground': string
    '--ring': string
    '--accent': string
    '--accent-foreground': string
    '--active-indicator': string
    '--color-active-indicator': string
}

export interface ColorTheme {
    slug: ColorThemeSlug
    label: string
    swatch: string
    swatchDark: string
    light: ColorThemeVars
    dark: ColorThemeVars
}

export const COLOR_THEMES: ColorTheme[] = [
    {
        slug: 'ocean-teal',
        label: 'Ocean Teal',
        swatch: '#0d9488',
        swatchDark: '#5eead4',
        light: {
            '--primary': '13 148 136',
            '--primary-foreground': '255 255 255',
            '--ring': '13 148 136',
            '--accent': '240 253 250',
            '--accent-foreground': '15 118 110',
            '--active-indicator': '#0d9488',
            '--color-active-indicator': '#0d9488',
        },
        dark: {
            '--primary': '13 148 136',
            '--primary-foreground': '255 255 255',
            '--ring': '94 234 212',
            '--accent': '30 41 59',
            '--accent-foreground': '94 234 212',
            '--active-indicator': '#5eead4',
            '--color-active-indicator': '#5eead4',
        },
    },
    {
        slug: 'coral-sunset',
        label: 'Coral Sunset',
        swatch: '#f43f5e',
        swatchDark: '#fb7185',
        light: {
            '--primary': '244 63 94',
            '--primary-foreground': '255 255 255',
            '--ring': '244 63 94',
            '--accent': '255 241 242',
            '--accent-foreground': '190 18 60',
            '--active-indicator': '#f43f5e',
            '--color-active-indicator': '#f43f5e',
        },
        dark: {
            '--primary': '251 113 133',
            '--primary-foreground': '255 255 255',
            '--ring': '251 113 133',
            '--accent': '30 41 59',
            '--accent-foreground': '253 164 175',
            '--active-indicator': '#fb7185',
            '--color-active-indicator': '#fb7185',
        },
    },
    {
        slug: 'arctic-blue',
        label: 'Arctic Blue',
        swatch: '#0ea5e9',
        swatchDark: '#38bdf8',
        light: {
            '--primary': '14 165 233',
            '--primary-foreground': '255 255 255',
            '--ring': '14 165 233',
            '--accent': '240 249 255',
            '--accent-foreground': '2 132 199',
            '--active-indicator': '#0ea5e9',
            '--color-active-indicator': '#0ea5e9',
        },
        dark: {
            '--primary': '56 189 248',
            '--primary-foreground': '15 23 42',
            '--ring': '56 189 248',
            '--accent': '30 41 59',
            '--accent-foreground': '125 211 252',
            '--active-indicator': '#38bdf8',
            '--color-active-indicator': '#38bdf8',
        },
    },
    {
        slug: 'golden-hour',
        label: 'Golden Hour',
        swatch: '#d97706',
        swatchDark: '#fbbf24',
        light: {
            '--primary': '217 119 6',
            '--primary-foreground': '255 255 255',
            '--ring': '217 119 6',
            '--accent': '255 251 235',
            '--accent-foreground': '180 83 9',
            '--active-indicator': '#d97706',
            '--color-active-indicator': '#d97706',
        },
        dark: {
            '--primary': '251 191 36',
            '--primary-foreground': '30 20 0',
            '--ring': '251 191 36',
            '--accent': '30 41 59',
            '--accent-foreground': '252 211 77',
            '--active-indicator': '#fbbf24',
            '--color-active-indicator': '#fbbf24',
        },
    },
    {
        slug: 'forest',
        label: 'Forest',
        swatch: '#16a34a',
        swatchDark: '#4ade80',
        light: {
            '--primary': '22 163 74',
            '--primary-foreground': '255 255 255',
            '--ring': '22 163 74',
            '--accent': '240 253 244',
            '--accent-foreground': '21 128 61',
            '--active-indicator': '#16a34a',
            '--color-active-indicator': '#16a34a',
        },
        dark: {
            '--primary': '74 222 128',
            '--primary-foreground': '15 23 42',
            '--ring': '74 222 128',
            '--accent': '30 41 59',
            '--accent-foreground': '134 239 172',
            '--active-indicator': '#4ade80',
            '--color-active-indicator': '#4ade80',
        },
    },
    {
        slug: 'lavender-haze',
        label: 'Lavender Haze',
        swatch: '#7c3aed',
        swatchDark: '#a78bfa',
        light: {
            '--primary': '124 58 237',
            '--primary-foreground': '255 255 255',
            '--ring': '124 58 237',
            '--accent': '245 243 255',
            '--accent-foreground': '109 40 217',
            '--active-indicator': '#7c3aed',
            '--color-active-indicator': '#7c3aed',
        },
        dark: {
            '--primary': '167 139 250',
            '--primary-foreground': '255 255 255',
            '--ring': '167 139 250',
            '--accent': '30 41 59',
            '--accent-foreground': '196 181 253',
            '--active-indicator': '#a78bfa',
            '--color-active-indicator': '#a78bfa',
        },
    },
]

export const DEFAULT_COLOR_THEME: ColorThemeSlug = 'ocean-teal'

export function findColorTheme(slug: ColorThemeSlug): ColorTheme {
    return COLOR_THEMES.find(t => t.slug === slug) ?? COLOR_THEMES[0]
}

/** CSS class name for web — empty string for default theme */
export function colorThemeClass(slug: ColorThemeSlug): string {
    return slug === 'ocean-teal' ? '' : `theme-${slug}`
}
