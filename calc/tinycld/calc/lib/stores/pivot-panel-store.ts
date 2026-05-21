import { create } from '@tinycld/core/lib/store'

interface PivotPanelState {
    openForSheetId: string | null
    open(sheetId: string): void
    close(): void
}

export const usePivotPanelStore = create<PivotPanelState>((set) => ({
    openForSheetId: null,
    open: (sheetId: string) => set({ openForSheetId: sheetId }),
    close: () => set({ openForSheetId: null }),
}))
