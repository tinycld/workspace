// Curated font-size and font-family option sets shared between the
// toolbar pickers (FontSizePicker / FontFamilyPicker) and the unit
// tests that pin their shape. The pickers themselves are .tsx and
// pull in react-native; keeping the option arrays here in a plain
// .ts module lets vitest import them without spinning up the RN
// shim under a node environment.

export interface FontOption {
    name: string
    fallback: 'sans-serif' | 'serif' | 'monospace'
}

// Dense at the body-text end (8..12), thinning out into common
// heading/display sizes above 14. Roughly matches Google Docs.
export const FONT_SIZE_OPTIONS: ReadonlyArray<number> = [
    8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72, 96,
]

// Web-safe + commonly-mapped Word fonts. Restricting to a curated set
// (rather than accepting arbitrary names) keeps imports from injecting
// obscure families that resolve to nothing on the user's machine.
export const FONT_FAMILY_OPTIONS: ReadonlyArray<FontOption> = [
    { name: 'Arial', fallback: 'sans-serif' },
    { name: 'Calibri', fallback: 'sans-serif' },
    { name: 'Helvetica', fallback: 'sans-serif' },
    { name: 'Tahoma', fallback: 'sans-serif' },
    { name: 'Verdana', fallback: 'sans-serif' },
    { name: 'Cambria', fallback: 'serif' },
    { name: 'Georgia', fallback: 'serif' },
    { name: 'Times New Roman', fallback: 'serif' },
    { name: 'Consolas', fallback: 'monospace' },
    { name: 'Courier New', fallback: 'monospace' },
    { name: 'Menlo', fallback: 'monospace' },
    { name: 'Monaco', fallback: 'monospace' },
]

// Multi-word family names must be quoted when emitted as a CSS
// font-family value — otherwise the browser splits at the first space.
export function cssFamily(name: string, fallback: FontOption['fallback']): string {
    const needsQuotes = /\s/.test(name)
    const quoted = needsQuotes ? `'${name}'` : name
    return `${quoted}, ${fallback}`
}
