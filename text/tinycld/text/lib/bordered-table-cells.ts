import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import {
    bordersAreEmpty,
    bordersToInlineStyleString,
    type CellBorders,
    parseBordersAttr,
} from './cell-borders'
import { normalizeHexColor } from './cell-shading'

// extendCellWithBorders adds a `borders` attribute and a `shading`
// (background color) attribute to TableCell / TableHeader.
//
// `borders` is the structured CellBorders shape; we serialize it to:
//   - a `data-borders` JSON attribute (so HTML serialization is
//     lossless — copy/paste, save-as-HTML, etc.)
//   - an inline `style` fragment with border-top/right/bottom/left
//     declarations (so the cell renders the chosen borders without
//     needing matching CSS rules per cell).
//
// `shading` is a CSS hex color string ("#RRGGBB") or null. It serializes
// to a `data-shading` attribute (for DOM round-trip) AND an inline
// `style: background-color: ...` declaration (so the rendered table
// actually shows the color without a per-cell CSS rule).
//
// Tiptap's mergeAttributes concatenates the `style` values returned
// from each renderHTML on the same node, so each attr returns only
// its own slice of CSS.
//
// The standard CSS in editor-content-styles.ts still applies a
// default 1px solid border to every cell; per-cell inline styles
// override it (CSS specificity: inline style wins). To clear a side,
// set its CellBorder to {style:'none'} — that emits `border-top: none`
// which beats the default rule.
//
// Used both in the web editor (use-document-editor.web.tsx) and the
// native WebView editor (Editor.tsx). One implementation keeps the
// schema identical on both sides, which matters: a doc seeded by one
// must be readable by the other, and Y.Doc collab requires identical
// schemas at every peer.
function extendWithBorders<T extends typeof TableCell | typeof TableHeader>(
    extension: T
): T {
    return extension.extend({
        addAttributes() {
            return {
                ...this.parent?.(),
                borders: {
                    default: null,
                    parseHTML: (el: HTMLElement) => parseBordersAttr(el.getAttribute('data-borders')),
                    renderHTML: (attrs: { borders?: CellBorders | null }) => {
                        if (bordersAreEmpty(attrs.borders)) return {}
                        const inline = bordersToInlineStyleString(attrs.borders)
                        return {
                            'data-borders': JSON.stringify(attrs.borders),
                            style: inline,
                        }
                    },
                },
                shading: {
                    default: null,
                    parseHTML: (el: HTMLElement) => parseShadingAttr(el),
                    renderHTML: (attrs: { shading?: string | null }) => {
                        const shading = normalizeHexColor(attrs.shading)
                        if (!shading) return {}
                        return {
                            'data-shading': shading,
                            style: `background-color: ${shading}`,
                        }
                    },
                },
            }
        },
    }) as T
}

// Read shading from `data-shading` first (round-tripped DOM), falling
// back to the inline `style="background-color: ..."` an external HTML
// source might have written. Returns null if neither yields a valid
// 6-digit hex.
function parseShadingAttr(el: HTMLElement): string | null {
    const dataShading = el.getAttribute('data-shading')
    const fromData = normalizeHexColor(dataShading)
    if (fromData) return fromData
    const inline = el.style.backgroundColor
    if (!inline) return null
    // rgb()/named colors aren't representable in <w:shd w:fill> so we
    // ignore them here — only round-trip explicit hex.
    if (inline.startsWith('#')) return normalizeHexColor(inline)
    return null
}

export const BorderedTableCell = extendWithBorders(TableCell)
export const BorderedTableHeader = extendWithBorders(TableHeader)
