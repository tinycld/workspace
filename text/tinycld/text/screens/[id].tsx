import { eq } from '@tanstack/db'
import { PresenceAvatars } from '@tinycld/core/components/PresenceAvatars'
import type { EditorCommands } from '@tinycld/core/lib/editor/types'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useCommentsDrawerStore } from '@tinycld/core/lib/stores/comments-drawer-store'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { CopyToFolderDialog } from '@tinycld/drive/components/CopyToFolderDialog'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Platform, ScrollView, Text, View } from 'react-native'
import { NewCommentButton } from '../components/comments/NewCommentButton'
import { OpenCommentsDrawerButton } from '../components/comments/OpenCommentsDrawerButton'
import { TextCommentDrawer } from '../components/comments/TextCommentDrawer'
import { DocumentContextMenu } from '../components/DocumentContextMenu'
import { DocumentTitle } from '../components/DocumentTitle'
import { DocumentToolbar } from '../components/DocumentToolbar'
import { FindReplaceBar, useFindReplaceShortcuts } from '../components/FindReplaceBar'
import { ImageAttrsBottomSheet } from '../components/ImageAttrsBottomSheet'
import { useImageInsert } from '../components/ImageInsertButton'
import { ImportWarningBanner } from '../components/ImportWarningBanner'
import { LinkPopover } from '../components/LinkPopover'
import { MenuBar } from '../components/menubar/MenuBar'
import { MobileToolbarAccessory } from '../components/MobileToolbarAccessory'
import { ReconnectingIndicator } from '../components/ReconnectingIndicator'
import { SaveStatusIndicator } from '../components/SaveStatusIndicator'
import { SlashMenu } from '../components/SlashMenu'
import { WordCountBadge } from '../components/WordCountBadge'
import { useDocumentComments } from '../hooks/use-document-comments'
import { useDocumentFileActions } from '../hooks/use-document-file-actions'
import { useNewCommentFlow } from '../hooks/use-new-comment-flow'
import { usePrintDocument } from '../hooks/use-print-document'
import { useTextDocument } from '../hooks/useTextDocument'
import { typedServerHello, useTextRoom } from '../hooks/useTextRoom'
import { FindReplaceEditorContext } from '../lib/find-replace-editor-context'
import { useFindReplaceStore } from '../lib/stores/find-replace-store'

export default function TextDetail() {
    const { id } = useLocalSearchParams<{ id: string }>()
    const [driveItemsCollection] = useStore('drive_items')

    const { data: items = [], isLoading: isItemLoading } = useOrgLiveQuery(
        (query, { orgId }) =>
            query
                .from({ item: driveItemsCollection })
                .where(({ item }) => eq(item.org, orgId))
                .where(({ item }) => eq(item.id, id ?? '')),
        [id]
    )

    const item = items[0]

    // Open the realtime room as soon as we have a document id. The
    // server populates the doc from the source .docx before the first
    // SyncReply arrives, so the client never needs the file source.
    const room = useTextRoom(item?.id ?? '')

    if (isItemLoading || !item) {
        return <CenteredMessage label="Loading document…" spinner />
    }

    if (room == null || !room.isReady) {
        return <CenteredMessage label="Opening…" spinner />
    }

    return (
        <DocumentScreen
            itemName={item.name}
            itemFile={item.file ?? ''}
            room={room}
            driveItemId={item.id}
        />
    )
}

interface DocumentScreenProps {
    itemName: string
    itemFile: string
    room: NonNullable<ReturnType<typeof useTextRoom>>
    driveItemId: string
}

function DocumentScreen({ itemName, itemFile, room, driveItemId }: DocumentScreenProps) {
    // The slash menu's "Image" entry routes through the same picker +
    // drive-upload pipeline the toolbar's image button uses. The picker
    // resolves async, by which point `commands` will have been bound;
    // a ref-backed indirection lets us pass a stable callback into
    // useDocumentEditor (which expects a stable identity in its deps
    // array) while still reaching into the live commands object the
    // hook returns to us.
    const commandsRef = useRef<EditorCommands | null>(null)
    const handleSlashMenuImageInserted = useCallback((url: string) => {
        commandsRef.current?.insertImage?.(url)
    }, [])
    const triggerSlashMenuImage = useImageInsert(handleSlashMenuImageInserted)
    const openSlashMenuImage = useCallback(() => {
        triggerSlashMenuImage()
    }, [triggerSlashMenuImage])
    const {
        EditorComponent,
        editor,
        commands,
        toolbarState,
        saveStatus,
        tiptapEditor,
        findReplaceEditor,
        commentBridge,
        webViewRef,
    } = useTextDocument(room, driveItemId, {
        onRequestInsertImage: openSlashMenuImage,
    })
    commandsRef.current = commands
    const hello = typedServerHello(room)
    const isReadOnly = hello.readOnly
    // Print routes through the server's /api/text/render endpoint
    // — no longer needs the editor handle. Print works even if the
    // editor isn't mounted yet (e.g. from the share screen).
    const printDocument = usePrintDocument(driveItemId)
    usePrintShortcut(printDocument)
    const fileActions = useDocumentFileActions(driveItemId)
    const orgHref = useOrgHref()
    // Link popover is reached from two surfaces — the toolbar's link
    // button and the context menu's "Insert link" item. We hoist its
    // open state here so both surfaces can drive it; the toolbar still
    // owns its own internal popover for the in-toolbar button path.
    const [contextLinkOpen, setContextLinkOpen] = useState(false)
    const documentComments = useDocumentComments(driveItemId, commentBridge)
    useCommentsLifecycle(driveItemId)
    useCommentTapHandler(driveItemId, commentBridge, documentComments)
    const newCommentFlow = useNewCommentFlow({
        driveItemId,
        commentBridge,
        selectionEmpty: toolbarState.selectionEmpty ?? true,
        editable: !isReadOnly,
    })

    // Open (unresolved, non-orphaned) thread count drives the badge on
    // the OpenCommentsDrawerButton. Recomputes when threads or the
    // orphan set change.
    const openThreadCount = useMemo(() => {
        const { threadsByCommentId, orphanedCommentIds } = documentComments
        let count = 0
        for (const [commentId, threads] of threadsByCommentId) {
            if (orphanedCommentIds.has(commentId)) continue
            for (const t of threads) {
                if (t.resolvedAt == null) count += 1
            }
        }
        return count
    }, [documentComments])

    return (
        <FindReplaceEditorContext.Provider value={findReplaceEditor}>
            <View className="flex-1 bg-background">
                <View className="px-4 py-2 border-b border-border flex-row items-center gap-3">
                    <DocumentTitle
                        documentId={driveItemId}
                        name={itemName}
                        isReadOnly={isReadOnly}
                    />
                    <PresenceAvatars awareness={room.awareness} />
                    <SaveStatusIndicator status={saveStatus} isConnected={room.isConnected} />
                    <WordCountBadge wordCount={toolbarState.wordCount} />
                    <ReconnectingIndicator isVisible={!room.isConnected} />
                    <View className="ml-auto flex-row items-center gap-1">
                        <OpenCommentsDrawerButton
                            driveItemId={driveItemId}
                            openCount={openThreadCount}
                        />
                    </View>
                </View>
                <ImportWarningBanner warnings={hello.importWarnings} />
                <MenuBar
                    documentName={itemName}
                    documentId={driveItemId}
                    sourceFile={itemFile}
                    commands={commands}
                    toolbarState={toolbarState}
                    fileActions={fileActions}
                    disabled={isReadOnly}
                    onPrint={() => {
                        void printDocument()
                    }}
                    onRequestInsertLink={() => setContextLinkOpen(true)}
                    onInsertImage={url => commands.insertImage?.(url)}
                    tiptapEditor={tiptapEditor}
                />
                <DocumentToolbar
                    commands={commands}
                    state={toolbarState}
                    disabled={isReadOnly}
                    newCommentFlow={{
                        canStart: newCommentFlow.canStart,
                        isOpen: newCommentFlow.isOpen,
                        start: newCommentFlow.start,
                    }}
                />
                <DocumentContextMenu
                    commands={commands}
                    toolbarState={toolbarState}
                    editable={!isReadOnly}
                    onRequestInsertLink={() => setContextLinkOpen(true)}
                    onRequestAddComment={newCommentFlow.start}
                    canAddComment={newCommentFlow.canStart}
                    className="flex-1"
                >
                    {Platform.OS === 'web' ? (
                        <ScrollView className="flex-1">
                            <View className="p-6 max-w-[800px] w-full self-center">
                                <EditorComponent />
                                <FindReplaceShell />
                            </View>
                        </ScrollView>
                    ) : (
                        <View className="flex-1">
                            <EditorComponent />
                            <FindReplaceShell />
                        </View>
                    )}
                </DocumentContextMenu>
                <LinkPopover
                    isOpen={contextLinkOpen}
                    initialUrl={toolbarState.currentLink ?? ''}
                    onCancel={() => setContextLinkOpen(false)}
                    onInsert={url => {
                        if (url) {
                            commands.setLink(url)
                        } else {
                            commands.removeLink()
                        }
                        setContextLinkOpen(false)
                    }}
                />
                <MobileToolbarAccessory
                    commands={commands}
                    toolbarState={toolbarState}
                    editable={!isReadOnly}
                />
                <ImageAttrsBottomSheet editable={!isReadOnly} commands={commands} />
                <CopyToFolderDialog
                    itemId={driveItemId}
                    onCopied={newItemId =>
                        router.replace(orgHref('text/[id]', { id: newItemId }))
                    }
                />
                <TextCommentDrawer
                    driveItemId={driveItemId}
                    documentComments={documentComments}
                    commentBridge={commentBridge}
                />
                {newCommentFlow.modal}
                <SlashMenu webViewRef={webViewRef ?? null} />
            </View>
        </FindReplaceEditorContext.Provider>
    )
}

// Lifecycle owner for the comments drawer at the document level.
// Resets the store when driveItemId changes so a navigation between
// documents can't leak focusedThreadId or an open drawer; reads the
// ?thread=<id> query param on mount so deep links land focused.
function useCommentsLifecycle(driveItemId: string) {
    const reset = useCommentsDrawerStore(s => s.reset)
    const open = useCommentsDrawerStore(s => s.open)
    const { thread } = useLocalSearchParams<{ thread?: string }>()

    useEffect(() => {
        reset()
        if (thread) {
            open({ packageSlug: 'text', driveItemId, threadId: thread })
        }
        return () => reset()
    }, [driveItemId, thread, reset, open])
}

// Bridges editor mark taps to the comments drawer. The bridge gives us
// a commentId (the mark's group key); the store focuses on a thread
// root id, so we resolve via the screen's already-built thread map.
// Reading the map through a ref keeps the bridge subscription stable
// across keystrokes — re-subscribing on every transaction would drop
// taps that arrive between unsubscribe and resubscribe.
function useCommentTapHandler(
    driveItemId: string,
    commentBridge: ReturnType<typeof useTextDocument>['commentBridge'],
    documentComments: ReturnType<typeof useDocumentComments>
) {
    const open = useCommentsDrawerStore(s => s.open)
    const threadsRef = useRef(documentComments.threadsByCommentId)
    threadsRef.current = documentComments.threadsByCommentId

    useEffect(() => {
        if (!commentBridge) return
        return commentBridge.onTap(commentId => {
            const threadId = threadsRef.current.get(commentId)?.[0]?.root.id ?? null
            open({
                packageSlug: 'text',
                driveItemId,
                threadId: threadId ?? undefined,
            })
        })
    }, [commentBridge, driveItemId, open])
}

interface CenteredMessageProps {
    label: string
    spinner?: boolean
}

function CenteredMessage({ label, spinner }: CenteredMessageProps) {
    return (
        <View className="flex-1 items-center justify-center gap-3 bg-background">
            {spinner ? <ActivityIndicator /> : null}
            <Text className="text-sm text-muted-foreground">{label}</Text>
        </View>
    )
}

// FindReplaceShell sits inside the FindReplaceEditorContext.Provider
// the screen wraps the document tree with, so useFindReplaceEditor()
// resolves the tiptap editor that the shell's `useFindReplaceShortcuts`
// + the bar's action buttons need to dispatch into. Toggles the bar
// on the store's isOpen flag.
function FindReplaceShell() {
    const isOpen = useFindReplaceStore(s => s.isOpen)
    useFindReplaceShortcuts()
    return <FindReplaceBar isVisible={isOpen} />
}

// Bind ⌘P / Ctrl+P → print. Web-only: native has no equivalent
// keyboard surface, and the upcoming menubar work will wire the
// platform-appropriate trigger for mobile.
function usePrintShortcut(printDocument: () => Promise<void>) {
    useEffect(() => {
        if (Platform.OS !== 'web' || typeof document === 'undefined') return
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
                e.preventDefault()
                void printDocument()
            }
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [printDocument])
}
