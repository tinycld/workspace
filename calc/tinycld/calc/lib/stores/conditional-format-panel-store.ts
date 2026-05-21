import { create } from '@tinycld/core/lib/store'

// usePivotPanelStore's calc-side cousin for the conditional-formatting
// authoring panel. Panel visibility is scoped to a single sheet at a
// time (Sheets parity) — opening it on a different sheet closes the
// previous instance.
//
// editingRuleId tracks what the user is currently editing in the
// panel:
//   - null: list mode, showing all rules for the sheet.
//   - '__new__': the user just clicked "+ Add rule"; the editor is
//     showing a fresh draft that hasn't been persisted yet.
//   - any other string: editing an existing rule by id.
//
// defaultRanges seeds the new-rule range input from whatever selection
// the user had when they opened the panel. Ignored when editing an
// existing rule.

export const NEW_RULE_ID = '__new__'

interface CFPanelState {
    openForSheetId: string | null
    editingRuleId: string | null
    defaultRanges: string[]
    open(sheetId: string, options?: { editingRuleId?: string; defaultRanges?: string[] }): void
    close(): void
    setEditingRule(id: string | null): void
}

export const useConditionalFormatPanelStore = create<CFPanelState>((set) => ({
    openForSheetId: null,
    editingRuleId: null,
    defaultRanges: [],
    open: (sheetId, options) =>
        set({
            openForSheetId: sheetId,
            editingRuleId: options?.editingRuleId ?? null,
            defaultRanges: options?.defaultRanges ?? [],
        }),
    close: () =>
        set({
            openForSheetId: null,
            editingRuleId: null,
            defaultRanges: [],
        }),
    setEditingRule: (id) => set({ editingRuleId: id }),
}))
