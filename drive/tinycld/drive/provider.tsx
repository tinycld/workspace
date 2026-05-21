import type { ReactNode } from 'react'
import { SaveToDriveDialog } from './components/SaveToDriveDialog'
import './lib/save-to-drive-action'

export default function DriveProvider({ children }: { children: ReactNode }) {
    return (
        <>
            {children}
            <SaveToDriveDialog />
        </>
    )
}
