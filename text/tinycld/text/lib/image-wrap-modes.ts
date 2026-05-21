// Single source of truth for the legal values of the WrappedImage
// `wrap` attribute. The toolbar UI, the WrappedImage schema (both web
// and WebView variants), and the unit tests all read from these
// helpers so the value set can't drift between sites.
//
// Naming: the persisted attribute is `null | 'left' | 'right' | 'break'`.
// `'inline'` exists only as a UX-facing label — it represents the
// absence of the attribute. wrapToAttr() returns null for 'inline' so
// the persisted DOM (and the DOCX exporter) never sees the literal
// string. This keeps every existing document byte-stable across the
// schema change: docs that had no `wrap` attr today stay attribute-free
// tomorrow, no spurious data-wrap="inline" leaks into serialized HTML.

export const IMAGE_WRAP_MODES = ['inline', 'left', 'right', 'break'] as const

export type WrapMode = (typeof IMAGE_WRAP_MODES)[number]

// Persisted attribute values — the subset of WrapMode that ever appears
// on a DOM element's data-wrap attribute (or in the PM schema's `wrap`
// attr). 'inline' is the absence-of-attribute case.
export type WrapAttr = Exclude<WrapMode, 'inline'>

// Normalize anything we might encounter (parsed HTML attrs, PM node
// attrs, user input) to a WrapMode. Unknown strings and falsy values
// collapse to 'inline' so the UX always has a defined state to render.
export function normalizeWrap(raw: unknown): WrapMode {
    if (raw === 'left' || raw === 'right' || raw === 'break') return raw
    return 'inline'
}

// Convert a WrapMode to the value that should land on the PM node's
// `wrap` attribute (and therefore the rendered data-wrap attribute).
// 'inline' returns null — callers pass the result straight to
// updateAttributes({ wrap: wrapToAttr(mode) }) and the schema treats
// null the same as "default", which is also null.
export function wrapToAttr(mode: WrapMode): WrapAttr | null {
    return mode === 'inline' ? null : mode
}
