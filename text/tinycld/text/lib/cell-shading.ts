// Cell shading (background color) for table cells. Round-trips to
// <w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="RRGGBB"/></w:tcPr>
// on the OOXML side, and to an inline `background-color` plus a
// `data-shading` attribute on the HTML/PM side.
//
// We restrict the editor UI to a curated palette so users can't paste
// arbitrary CSS color strings — anything that round-trips through
// PocketBase needs to survive a JSON marshal and end up on a Word
// document, and free-form input would otherwise let people sneak in
// `rgb(...)` values that Word can't represent in <w:shd w:fill>.
//
// Storage shape on the PM node attribute: a hex string of the form
// `"#RRGGBB"` (uppercase, leading '#'), or null for no shading. The
// Go translate layer normalizes whatever the .docx had on import and
// strips the '#' on export.

export interface CellShadingOption {
    label: string
    // null = "no shading" (clears the attr).
    value: string | null
}

// Curated palette tuned for both light and dark mode readability. The
// hex literals are USER DATA (the actual shading color a user picks),
// not component styling — they get written into the document and
// round-tripped through .docx. They are NOT theme tokens.
export const CELL_SHADING_PALETTE: readonly CellShadingOption[] = [
    { label: 'None', value: null },
    { label: 'Yellow', value: '#FFFF00' },
    { label: 'Light Yellow', value: '#FFF9C4' },
    { label: 'Light Green', value: '#C8E6C9' },
    { label: 'Light Blue', value: '#BBDEFB' },
    { label: 'Light Red', value: '#FFCDD2' },
    { label: 'Light Purple', value: '#E1BEE7' },
    { label: 'Light Orange', value: '#FFE0B2' },
    { label: 'Light Gray', value: '#E0E0E0' },
    { label: 'Dark Gray', value: '#9E9E9E' },
    { label: 'Black', value: '#000000' },
] as const

const HEX_RE = /^#?[0-9a-fA-F]{6}$/

// True for `#RRGGBB` or bare `RRGGBB` (any case). 3-digit shorthand is
// intentionally rejected — Word's w:fill takes 6 hex digits and we
// don't want a silent expansion (e.g. "#F00" → "#FF0000") to ride
// through round-trips.
export function isValidHexColor(value: string | null | undefined): boolean {
    if (!value) return false
    return HEX_RE.test(value)
}

// Returns a canonical `#RRGGBB` (uppercase, with leading '#'), or null
// if the input isn't a valid 6-digit hex. Accepts the form Word emits
// in w:fill ("FFFF00") and the form the editor stores ("#FFFF00").
export function normalizeHexColor(value: string | null | undefined): string | null {
    if (!value) return null
    if (!HEX_RE.test(value)) return null
    const hex = value.startsWith('#') ? value.slice(1) : value
    return `#${hex.toUpperCase()}`
}
