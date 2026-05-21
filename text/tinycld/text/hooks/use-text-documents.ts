import { and, eq } from '@tanstack/db'
import { captureException } from '@tinycld/core/lib/errors'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useCreateDriveItem } from '@tinycld/drive/lib/upload-to-drive'
import { useCallback } from 'react'
import { createBlankTextDocument } from '../lib/create-blank-text-document'
import { createTextDocumentFromTemplate } from '../lib/create-text-document-from-template'
import { DOCX_MIME_TYPE } from '../lib/mime'
import type { TemplateId } from '../lib/templates/index'

// Shared list query: the docx-mime-typed, non-folder drive_items for
// the current org, newest-updated first. Same shape both the
// /text index screen and the sidebar's "Recent" list use; factored
// out so the two surfaces can't drift on filter ordering / where
// clauses / org scoping.
export function useTextDocuments() {
    const [driveItemsCollection] = useStore('drive_items')
    return useOrgLiveQuery((query, { orgId }) =>
        query
            .from({ item: driveItemsCollection })
            .where(({ item }) =>
                and(
                    eq(item.org, orgId),
                    eq(item.mime_type, DOCX_MIME_TYPE),
                    eq(item.is_folder, false)
                )
            )
            .orderBy(({ item }) => item.updated, 'desc')
    )
}

// Wraps useCreateDriveItem + the blank-docx blob helper into a single
// callable. Returns an object that mirrors the underlying mutation's
// shape (`isPending` for "Creating…" UI labels) plus a `create(onCreated)`
// callable so the call site doesn't have to thread captureException +
// the blank blob construction itself.
export function useCreateBlankTextDocument() {
    const mutation = useCreateDriveItem()
    const create = useCallback(
        (onCreated: (itemId: string) => void) => {
            createBlankTextDocument({ mutate: mutation.mutate, onCreated, captureException })
        },
        [mutation.mutate]
    )
    return { create, isPending: mutation.isPending }
}

// Same shape as useCreateBlankTextDocument but takes a templateId at
// call time so one mutation instance backs all template choices. The
// underlying helper materializes the embedded bytes synchronously, so
// switching templates between clicks doesn't require resetting the
// mutation. Returning the same `{ create, isPending }` tuple keeps the
// caller code at parity with the blank flow.
export function useCreateTextDocumentFromTemplate() {
    const mutation = useCreateDriveItem()
    const create = useCallback(
        (templateId: TemplateId, onCreated: (itemId: string) => void) => {
            createTextDocumentFromTemplate({
                templateId,
                mutate: mutation.mutate,
                onCreated,
                captureException,
            })
        },
        [mutation.mutate]
    )
    return { create, isPending: mutation.isPending }
}
