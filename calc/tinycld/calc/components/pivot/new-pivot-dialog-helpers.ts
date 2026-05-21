// Pure helpers for the NewPivotDialog. Lives in its own .ts module so
// vitest can exercise the validation + id-generation logic without
// dragging react-native into the test transform — same pattern as
// pivot-grid-view-state.ts, field-row-helpers.ts, and
// pivot-side-panel-helpers.ts.
//
// The .tsx component stays a thin renderer; anything with a branch,
// a Zod schema, or a side-effect-free transform belongs here.

// We import zod directly here (rather than re-export it through
// @tinycld/core/ui/form) so vitest can load this module without
// pulling in react-native via the form barrel. The barrel exists for
// .tsx callers that want one import for the form library + RN-styled
// inputs; pure helper modules go straight to zod.
import { z } from 'zod'
import { parseA1Range } from '../../lib/pivot/range-parse'
import type { PivotDefinition } from '../../lib/workbook-types'

// Form schema. `sourceRange` must parse as an A1 range; targetSheetName
// must be non-empty after trimming. We intentionally do NOT enforce
// sheet-name uniqueness in the schema — the lower-level addSheet writer
// suffixes duplicates with the new sheetId (see useSheetActions), and
// the dialog runs inside a transient form context with no easy way to
// inspect the live Y.Doc here. The downstream sheet creator is the
// authoritative dedupe point.
export const newPivotSchema = z.object({
    sourceRange: z
        .string()
        .trim()
        .min(1, 'Required')
        .refine(value => parseA1Range(value).ok, {
            message: 'Use the form "Sheet1!A1:E100".',
        }),
    targetSheetName: z.string().trim().min(1, 'Required').max(120),
})

export type NewPivotFormValues = z.infer<typeof newPivotSchema>

// makePivotId generates a short, monotonically-increasing id for a new
// PivotDefinition. Time-based with a small alphabet keeps the
// human-readable URL/state inspector friendly without dragging in a
// uuid lib. Collisions across a single user's session would require
// two pivots created within the same ms, which is the same loose
// guarantee the sheet-tab naming uses elsewhere.
//
// The accepted `nowMs` argument is for deterministic testing — callers
// in the dialog leave it undefined so it defaults to Date.now().
export function makePivotId(nowMs?: number): string {
    const t = nowMs ?? Date.now()
    return `p${t.toString(36)}`
}

// Build the initial PivotDefinition for a brand-new pivot. Rows / cols /
// values / filters all start empty so the user lands on the "Configure
// your pivot" empty state in PivotGrid and drags fields in from the
// side panel. Both grand-total toggles default to true (mirrors Sheets);
// subtotal toggles default to false (the pivot has no grouping yet
// anyway, so the choice doesn't matter at v1 — but defaulting them off
// keeps the side panel state visibly minimal).
export function buildInitialPivotDefinition(args: {
    id: string
    sourceRange: string
    targetSheetName: string
}): PivotDefinition {
    return {
        id: args.id,
        sourceRange: args.sourceRange,
        targetSheetName: args.targetSheetName,
        rows: [],
        cols: [],
        values: [],
        filters: [],
        filterSelections: {},
        rowGrandTotals: true,
        colGrandTotals: true,
        rowSubtotals: false,
        colSubtotals: false,
    }
}

// Default sheet name suggested in the dialog. "Pivot of <activeSheet>"
// mirrors Sheets/Excel and is descriptive enough that most users won't
// rename it. Sheet names are bounded to 31 chars in xlsx so we leave
// the truncation to whatever opens this sheet for export — the dialog
// itself accepts up to 120 chars.
export function defaultTargetSheetName(activeSheetName: string): string {
    const trimmed = activeSheetName.trim()
    if (trimmed === '') return 'Pivot of Sheet'
    return `Pivot of ${trimmed}`
}
