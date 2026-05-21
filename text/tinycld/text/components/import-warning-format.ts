// Pure formatters extracted from ImportWarningBanner.tsx so unit
// tests can lock the visible copy without rendering the RN tree
// under vitest's node environment. The RN component imports these
// and inlines them into its <Text> nodes.

export interface ImportWarning {
    code: string
    detail?: string
}

/**
 * Format one warning as the single-line string the banner renders.
 *   - `{code: 'unsupported-feature'}` → `"unsupported-feature"`
 *   - `{code: 'image-inlined', detail: '120kb'}` → `"image-inlined: 120kb"`
 *   - empty detail string is treated as absent (no trailing colon).
 */
export function formatImportWarning(w: ImportWarning): string {
    return w.detail ? `${w.code}: ${w.detail}` : w.code
}

/**
 * Banner title. Sources the count from the warnings array length;
 * see the .map() inside the component.
 */
export function importWarningTitle(count: number): string {
    return `Import warnings (${count})`
}
