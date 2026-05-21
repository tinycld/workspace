import { captureException } from '@tinycld/core/lib/errors'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { pb } from '@tinycld/core/lib/pocketbase'
import { ConfirmDialog } from '@tinycld/core/ui/ConfirmDialog'
import { Menu, MenuBarMenu, MenuShortcut, Separator } from '@tinycld/core/ui/menubar'
import { PromptDialog } from '@tinycld/core/ui/PromptDialog'
import { router } from 'expo-router'
import { useState } from 'react'
import type { PMNode } from '../../lib/markdown/types'
import type { MenuBarProps } from './MenuBar'
import { SaveVersionDialog } from './SaveVersionDialog'

export function FileMenu(props: MenuBarProps) {
    const orgHref = useOrgHref()
    const [isSaveVersionOpen, setSaveVersionOpen] = useState(false)
    const [isCopyOpen, setCopyOpen] = useState(false)
    const [isRenameOpen, setRenameOpen] = useState(false)
    const [isTrashOpen, setTrashOpen] = useState(false)

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

    const downloadSource = () => {
        if (!props.sourceFile) return
        const url = pb.files.getURL({ collectionId: 'drive_items', id: props.documentId }, props.sourceFile)
        if (typeof window !== 'undefined') {
            window.open(url, '_blank')
        }
    }

    // Tiptap's getJSON returns the editor's current PM JSON tree. We
    // hand it straight to pmToMarkdown — the supported subset matches
    // what the .docx exporter handles, and unsupported nodes (comments,
    // footnotes, color/font/size, alignment, image dims/wrap, cell
    // shading) degrade silently. Users wanting full fidelity should
    // use Download (.docx). Help topic: text:markdown.
    //
    // Dynamic-imported because pmToMarkdown lives in a module that
    // transitively pulls markdown-it; markdown-it ships ESM .mjs files
    // that crash on Hermes when evaluated at module init. The download
    // path is web-only anyway (it builds a Blob + clicks an <a>), so
    // moving the markdown imports into the handler keeps them off the
    // native module-init path.
    const downloadMarkdown = async () => {
        if (typeof window === 'undefined') return
        const editor = props.tiptapEditor
        if (!editor) return
        try {
            const { pmToMarkdown } = await import('../../lib/markdown/pm-to-md')
            const md = pmToMarkdown(editor.getJSON() as unknown as PMNode)
            const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            const base = props.documentName?.trim() || 'document'
            a.download = base.endsWith('.md') ? base : `${base}.md`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            // Defer revoke so Safari finishes the download before the
            // object URL is invalidated.
            setTimeout(() => URL.revokeObjectURL(url), 0)
        } catch (err) {
            captureException('text.downloadMarkdown', err)
        }
    }

    return (
        <>
            <MenuBarMenu menuId="file" label="File">
                <Menu.Item onPress={() => router.push(orgHref('text'))}>
                    <Menu.ItemTitle>New document</Menu.ItemTitle>
                </Menu.Item>
                <Menu.Item onPress={() => router.push(orgHref('drive'))}>
                    <Menu.ItemTitle>Open</Menu.ItemTitle>
                </Menu.Item>
                <Menu.Item onPress={() => setCopyOpen(true)}>
                    <Menu.ItemTitle>Make a copy</Menu.ItemTitle>
                </Menu.Item>
                <Menu.Item onPress={() => setSaveVersionOpen(true)}>
                    <Menu.ItemTitle>Save version</Menu.ItemTitle>
                </Menu.Item>
                <Separator />
                <Menu.Item onPress={downloadSource} isDisabled={!props.sourceFile}>
                    <Menu.ItemTitle>Download (.docx)</Menu.ItemTitle>
                </Menu.Item>
                <Menu.Item onPress={downloadMarkdown} isDisabled={!props.tiptapEditor}>
                    <Menu.ItemTitle>Download (.md)</Menu.ItemTitle>
                </Menu.Item>
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
                <Menu.Item onPress={props.onPrint}>
                    <Menu.ItemTitle>Print</Menu.ItemTitle>
                    <MenuShortcut keys="⌘P" />
                </Menu.Item>
            </MenuBarMenu>
            <SaveVersionDialog
                isOpen={isSaveVersionOpen}
                onClose={() => setSaveVersionOpen(false)}
                documentId={props.documentId}
            />
            <PromptDialog
                isOpen={isCopyOpen}
                onClose={() => setCopyOpen(false)}
                onSubmit={handleCopy}
                title="Make a copy"
                placeholder="Copy name"
                defaultValue={`${props.documentName} (copy)`}
                confirmLabel="Create copy"
                required
            />
            <PromptDialog
                isOpen={isRenameOpen}
                onClose={() => setRenameOpen(false)}
                onSubmit={handleRename}
                title="Rename"
                defaultValue={props.documentName}
                confirmLabel="Rename"
                required
            />
            <ConfirmDialog
                isOpen={isTrashOpen}
                onClose={() => setTrashOpen(false)}
                onConfirm={handleTrash}
                title="Move to trash"
                message="This document will be moved to the trash. You can restore it from Drive within the retention window."
                confirmLabel="Move to trash"
                isDestructive
            />
        </>
    )
}
