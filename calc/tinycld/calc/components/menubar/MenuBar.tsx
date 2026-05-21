import { MenuBar as CoreMenuBar } from '@tinycld/core/ui/menubar'
import type { WorkbookFileActions } from '../../hooks/use-workbook-file-actions'
import type { ToolbarProps } from '../Toolbar'
import { DataMenu } from './DataMenu'
import { EditMenu } from './EditMenu'
import { FileMenu } from './FileMenu'
import { FormatMenu } from './FormatMenu'
import { HelpMenu } from './HelpMenu'
import { ViewMenu } from './ViewMenu'

export interface MenuBarProps extends ToolbarProps {
    workbookId: string
    workbookName: string
    fileActions: WorkbookFileActions
    onClearFormatting: () => void
    onCopy: () => void
    onCut: () => void
    onPaste: () => void
    onPasteValues: () => void
    onPasteFormat: () => void
    onOpenFindReplace: () => void
    onOpenConditionalFormatting: () => void
    allSheets: ReadonlyArray<{ id: string; name: string; hidden?: boolean }>
    onShowSheet: (sheetId: string) => void
    onShowComments: () => void
}

export function MenuBar(props: MenuBarProps) {
    return (
        <CoreMenuBar>
            <FileMenu {...props} />
            <EditMenu {...props} />
            <ViewMenu {...props} />
            <FormatMenu {...props} />
            <DataMenu {...props} />
            <HelpMenu />
        </CoreMenuBar>
    )
}
