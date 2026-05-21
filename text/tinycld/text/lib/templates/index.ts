// Document-template registry. The four shipping templates are sourced
// from the Go generator at server/cmd/gen-templates — the .docx bytes
// it emits are embedded as base64 in templates.generated.ts and
// surfaced here alongside the human-visible metadata (name,
// description).
//
// The registry is the contract between the picker UI (which shows the
// list of cards) and the upload pipeline (which materializes the bytes
// at click time). Adding a template means: add an entry in the Go
// generator, regenerate, and add the matching display metadata below
// keyed by the same id.

import { GENERATED_TEMPLATE_BYTES } from './templates.generated'

export type TemplateId = 'blank' | 'letter' | 'resume' | 'report'

export interface TextTemplate {
    /** Stable id — matches the .docx filename in assets/templates and
     *  the entry in templates.generated.ts. */
    id: TemplateId
    /** Display name for the picker card. */
    name: string
    /** One-sentence description shown under the name on the picker card. */
    description: string
    /** Human-visible filename the upload uses before deduplication. */
    fileName: string
}

// The picker renders this list in order, so blank goes first so users
// who just want an empty doc don't have to scan past three styled
// templates first.
export const TEXT_TEMPLATES: ReadonlyArray<TextTemplate> = [
    {
        id: 'blank',
        name: 'Blank',
        description: 'Start with an empty document.',
        fileName: 'Untitled.docx',
    },
    {
        id: 'letter',
        name: 'Letter',
        description: 'Formal letter with sender, recipient, salutation, and signature.',
        fileName: 'Letter.docx',
    },
    {
        id: 'resume',
        name: 'Resume',
        description: 'Basic CV layout with experience, education, and skills.',
        fileName: 'Resume.docx',
    },
    {
        id: 'report',
        name: 'Report',
        description: 'Business report with summary, background, findings, and recommendations.',
        fileName: 'Report.docx',
    },
]

// Lookup-by-id is needed both at load time (helper below) and at upload
// time (the create-from-template helper). Build the map once at module
// load so consumers don't have to .find() through the array.
const TEMPLATE_BYTES_BY_ID = new Map<string, string>(
    GENERATED_TEMPLATE_BYTES.map(entry => [entry.id, entry.base64])
)

const TEMPLATE_BY_ID = new Map<TemplateId, TextTemplate>(
    TEXT_TEMPLATES.map(entry => [entry.id, entry])
)

export function getTemplate(id: TemplateId): TextTemplate {
    const t = TEMPLATE_BY_ID.get(id)
    if (!t) {
        throw new Error(`Unknown text template id: ${id}`)
    }
    return t
}

/**
 * Returns the embedded base64 bytes for a template id, or throws when
 * the id is missing from the generated bundle. Separated from the
 * Blob/Uint8Array materialization (see load-template.ts) so the
 * registry can stay free of platform-specific concerns.
 */
export function getTemplateBase64(id: TemplateId): string {
    const b64 = TEMPLATE_BYTES_BY_ID.get(id)
    if (!b64) {
        throw new Error(`Unknown text template id: ${id}`)
    }
    return b64
}
