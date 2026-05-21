import type { UseMutateFunction } from '@tanstack/react-query'
import type {
    CreateDriveItemInput,
    CreateDriveItemResult,
} from '@tinycld/drive/lib/upload-to-drive'
import { DOCX_MIME_TYPE } from './mime'

// An empty Blob carrying the docx mime type. The server-side bootstrap hook is
// responsible for synthesizing a minimal valid .docx skeleton when the doc is
// empty — clients only need a mime-type-tagged placeholder so the drive_items
// row gets created.
function blankDocxBlob(): Blob {
    return new Blob([], { type: DOCX_MIME_TYPE })
}

export interface CreateBlankTextDocumentDeps {
    mutate: UseMutateFunction<CreateDriveItemResult, Error, CreateDriveItemInput>
    onCreated: (itemId: string) => void
    captureException: (tag: string, err: unknown) => void
}

// Triggers the drive item create for an empty docx and routes consumers to the
// freshly-minted document on success. We use `mutate` (fire-and-forget with
// callbacks) rather than `mutateAsync` so the surrounding call site doesn't
// need to be async and we can guarantee `captureException` runs on every
// failure path — including ones the underlying hook already reports — without
// the call site having to swallow rejected promises.
export function createBlankTextDocument({
    mutate,
    onCreated,
    captureException,
}: CreateBlankTextDocumentDeps): void {
    mutate(
        {
            body: blankDocxBlob(),
            name: 'Untitled.docx',
            mimeType: DOCX_MIME_TYPE,
        },
        {
            onSuccess: result => onCreated(result.itemId),
            onError: err => captureException('text.createDoc', err),
        }
    )
}
