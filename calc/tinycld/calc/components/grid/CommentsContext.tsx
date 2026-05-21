import { createContext, type ReactNode, useContext } from 'react'
import type { CellCommentsResult } from '../../hooks/use-cell-comments'

// Provided by the screen so cells / popovers can read the workbook's
// comment thread map without each one re-running useLiveQuery. The
// result Map identity changes only when calc_comments rows change for
// the active drive_item.
const CommentsContext = createContext<CellCommentsResult | null>(null)

interface ProviderProps {
    value: CellCommentsResult
    children: ReactNode
}

export function CommentsProvider({ value, children }: ProviderProps) {
    return <CommentsContext.Provider value={value}>{children}</CommentsContext.Provider>
}

export function useCommentsContext(): CellCommentsResult | null {
    return useContext(CommentsContext)
}
