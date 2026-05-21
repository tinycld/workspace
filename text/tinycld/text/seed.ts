import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type PocketBase from 'pocketbase'
import { DOCX_MIME_TYPE } from './lib/mime'

interface SeedContext {
    user: { id: string; email: string; name: string }
    org: { id: string }
    userOrg: { id: string }
}

function log(...args: unknown[]) {
    process.stdout.write(`[seed:text] ${args.join(' ')}\n`)
}

const FIXTURE_PATH = path.resolve(
    import.meta.dirname,
    '..',
    '..',
    'tests',
    'assets',
    'feature-test.docx'
)

export default async function seed(pb: PocketBase, ctx: SeedContext): Promise<void> {
    const { org, userOrg } = ctx
    const fileName = 'Feature Test.docx'

    const existing = await pb.collection('drive_items').getList(1, 1, {
        filter: pb.filter('org = {:org} && name = {:name}', { org: org.id, name: fileName }),
    })
    if (existing.items.length > 0) {
        log(`Skipping (already seeded): ${fileName}`)
        return
    }

    const buffer = await readFile(FIXTURE_PATH)
    const blob = new Blob([buffer], { type: DOCX_MIME_TYPE })
    log(`Uploading sample document: ${fileName} (${buffer.byteLength} bytes)`)

    const formData = new FormData()
    formData.append('org', org.id)
    formData.append('name', fileName)
    formData.append('is_folder', 'false')
    formData.append('mime_type', DOCX_MIME_TYPE)
    formData.append('parent', '')
    formData.append('created_by', userOrg.id)
    formData.append('size', String(buffer.byteLength))
    formData.append('description', '')
    formData.append('file', blob, fileName)
    await pb.collection('drive_items').create(formData)
}
