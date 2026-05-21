import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { ConfirmDialog } from '@tinycld/core/ui/ConfirmDialog'
import { Menu, MenuBarMenu, MenuShortcut, Separator } from '@tinycld/core/ui/menubar'
import { PromptDialog } from '@tinycld/core/ui/PromptDialog'
import { router } from 'expo-router'
import { useState } from 'react'
import type { MenuBarProps } from './MenuBar'
import { SaveVersionDialog } from './SaveVersionDialog'

export function FileMenu(props: MenuBarProps) {
    const orgHref = useOrgHref()
    const [isSaveVersionOpen, setSaveVersionOpen] = useState(false)
    const [isCopyOpen, setCopyOpen] = useState(false)
    const [isRenameOpen, setRenameOpen] = useState(false)
    const [isTrashOpen, setTrashOpen] = useState(false)
    // The CSV import flow lives on the calc index screen (it owns the
    // file-picker and the staged-rows handoff via `setPendingImport`).
    // From the detail screen we just bounce back to the index — opening
    // the picker there matches Sheets' "Import" behavior.
    const openImport = () => router.push(orgHref('calc'))

    const handleCopy = (name: string) => {
        props.fileActions.makeCopy(name)
        setCopyOpen(false)
    }

    const handleRename = (name: string) => {
        props.fileActions.rename(name)
        setRenameOpen(false)
    }

    const handleTrash = () => {
        props.fileActions.moveToTrash()
        setTrashOpen(false)
    }

    return (
        <>
            <MenuBarMenu menuId="file" label="File">
                <Menu.Item onPress={() => router.push(orgHref('calc'))}>
                    <Menu.ItemTitle>New spreadsheet</Menu.ItemTitle>
                </Menu.Item>
                <Menu.Item onPress={() => router.push(orgHref('drive'))}>
                    <Menu.ItemTitle>Open</Menu.ItemTitle>
                </Menu.Item>
                <Menu.Item onPress={openImport}>
                    <Menu.ItemTitle>Import</Menu.ItemTitle>
                </Menu.Item>
                <Menu.Item onPress={() => setCopyOpen(true)}>
                    <Menu.ItemTitle>Make a copy</Menu.ItemTitle>
                </Menu.Item>
                <Menu.Item onPress={() => setSaveVersionOpen(true)}>
                    <Menu.ItemTitle>Save version</Menu.ItemTitle>
                </Menu.Item>
                <Separator />
                <Menu.Sub>
                    <Menu.SubTrigger>
                        <Menu.ItemTitle>Download</Menu.ItemTitle>
                    </Menu.SubTrigger>
                    <Menu.SubContent>
                        {props.onDownloadXlsx != null && (
                            <Menu.Item onPress={props.onDownloadXlsx}>
                                <Menu.ItemTitle>Download as XLSX</Menu.ItemTitle>
                            </Menu.Item>
                        )}
                        <Menu.Item onPress={props.onDownloadCsvCurrent}>
                            <Menu.ItemTitle>Download as CSV (current sheet)</Menu.ItemTitle>
                        </Menu.Item>
                        <Menu.Item onPress={props.onDownloadCsvAll}>
                            <Menu.ItemTitle>Download as CSV (all sheets)</Menu.ItemTitle>
                        </Menu.Item>
                    </Menu.SubContent>
                </Menu.Sub>
                <Separator />
                <Menu.Item onPress={() => setRenameOpen(true)}>
                    <Menu.ItemTitle>Rename</Menu.ItemTitle>
                </Menu.Item>
                <Menu.Item onPress={() => setTrashOpen(true)}>
                    <Menu.ItemTitle>Move to trash</Menu.ItemTitle>
                </Menu.Item>
                <Menu.Item onPress={props.fileActions.openDriveDetails}>
                    <Menu.ItemTitle>Details</Menu.ItemTitle>
                </Menu.Item>
                <Separator />
                <Menu.Item onPress={props.onOpenPrint}>
                    <Menu.ItemTitle>Print</Menu.ItemTitle>
                    <MenuShortcut keys="⌘P" />
                </Menu.Item>
            </MenuBarMenu>
            <SaveVersionDialog
                isOpen={isSaveVersionOpen}
                onClose={() => setSaveVersionOpen(false)}
                workbookId={props.workbookId}
            />
            <PromptDialog
                isOpen={isCopyOpen}
                onClose={() => setCopyOpen(false)}
                onSubmit={handleCopy}
                title="Make a copy"
                placeholder="Copy name"
                defaultValue={`${props.workbookName} (copy)`}
                confirmLabel="Create copy"
                required
            />
            <PromptDialog
                isOpen={isRenameOpen}
                onClose={() => setRenameOpen(false)}
                onSubmit={handleRename}
                title="Rename"
                defaultValue={props.workbookName}
                confirmLabel="Rename"
                required
            />
            <ConfirmDialog
                isOpen={isTrashOpen}
                onClose={() => setTrashOpen(false)}
                onConfirm={handleTrash}
                title="Move to trash"
                message="This spreadsheet will be moved to the trash. You can restore it from Drive within the retention window."
                confirmLabel="Move to trash"
                isDestructive
            />
        </>
    )
}
