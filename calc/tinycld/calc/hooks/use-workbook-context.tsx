import { createContext, type ReactNode, useContext } from 'react'
import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'

export interface WorkbookContextValue {
    doc: Y.Doc
    awareness: Awareness
    isReady: boolean
    isConnected: boolean
}

const WorkbookContext = createContext<WorkbookContextValue | null>(null)

export interface WorkbookProviderProps extends WorkbookContextValue {
    children: ReactNode
}

export function WorkbookProvider({
    doc,
    awareness,
    isReady,
    isConnected,
    children,
}: WorkbookProviderProps) {
    const value: WorkbookContextValue = { doc, awareness, isReady, isConnected }
    return <WorkbookContext.Provider value={value}>{children}</WorkbookContext.Provider>
}

// useWorkbook reads the Y.Doc + Awareness out of the surrounding
// WorkbookProvider. Throws if called outside a provider — that signals
// a wiring mistake that should surface loudly during dev.
export function useWorkbook(): WorkbookContextValue {
    const ctx = useContext(WorkbookContext)
    if (ctx == null) {
        throw new Error('useWorkbook must be used inside a <WorkbookProvider>')
    }
    return ctx
}
