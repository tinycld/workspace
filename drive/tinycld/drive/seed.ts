import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type PocketBase from 'pocketbase'

function log(...args: unknown[]) {
    process.stdout.write(`[seed:drive] ${args.join(' ')}\n`)
}

interface SeedContext {
    user: { id: string; email: string; name: string }
    org: { id: string }
    userOrg: { id: string }
}

const ASSETS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../tests/assets')

const ASSET_FILES = {
    docx: {
        filename: 'sample.docx',
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
    xlsx: {
        filename: 'sample.xlsx',
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    pptx: {
        filename: 'sample.pptx',
        mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    },
    pdf: { filename: 'funny-jokes.pdf', mime: 'application/pdf' },
    png: { filename: 'fish.png', mime: 'image/png' },
    jpg: { filename: 'mountains.jpg', mime: 'image/jpeg' },
    hippo: { filename: 'hippo.jpg', mime: 'image/jpeg' },
    fish: { filename: 'fish.png', mime: 'image/png' },
    mountains: { filename: 'mountains.jpg', mime: 'image/jpeg' },
    funnyJokes: { filename: 'funny-jokes.pdf', mime: 'application/pdf' },
} as const

type AssetKey = keyof typeof ASSET_FILES

// Extension → mime mapping for fake (no-blob) files. The drive UI picks an
// icon from mime_type alone, so a record with size: 0 and no `file` field
// renders correctly in the listing — only download is a no-op.
const MIME_BY_EXT: Record<string, string> = {
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ppt: 'application/vnd.ms-powerpoint',
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/plain',
    csv: 'text/csv',
    json: 'application/json',
    html: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    ts: 'text/javascript',
    zip: 'application/zip',
    gz: 'application/gzip',
    tar: 'application/x-tar',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    flac: 'audio/flac',
}

function mimeForName(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

function loadAsset(key: AssetKey): { blob: Blob; size: number; mime: string; filename: string } {
    const asset = ASSET_FILES[key]
    const filePath = resolve(ASSETS_DIR, asset.filename)
    const buffer = readFileSync(filePath)
    return {
        blob: new Blob([buffer], { type: asset.mime }),
        size: buffer.byteLength,
        mime: asset.mime,
        filename: asset.filename,
    }
}

// Folder structure: root folders and nested subfolders
const FOLDERS = [
    { key: 'projects', name: 'Projects', parent: null },
    { key: 'shared-docs', name: 'Shared Documents', parent: null },
    { key: 'personal', name: 'Personal', parent: null },
    { key: 'archive', name: 'Archive', parent: null },
    { key: 'q1-planning', name: 'Q1 Planning', parent: 'projects' },
    { key: 'marketing', name: 'Marketing', parent: 'projects' },
    { key: 'engineering', name: 'Engineering', parent: 'projects' },
    { key: 'api-docs', name: 'API Documentation', parent: 'engineering' },
] as const

const FILES: {
    name: string
    asset?: AssetKey
    folder: string | null
    shared: boolean
    starred: boolean
    description: string
}[] = [
    // Root — visible immediately on opening drive. Every file in
    // drive/tests/assets/ is uploaded here as a real-backed root entry
    // (used to verify image previews, viewer rendering, and download
    // paths). The remaining entries below are metadata-only: size 0,
    // no `file` field, mime_type drives the icon.
    {
        name: 'Hippo.jpg',
        asset: 'hippo',
        folder: null,
        shared: true,
        starred: true,
        description: 'A friendly hippo',
    },
    {
        name: 'Mountains.jpg',
        asset: 'mountains',
        folder: null,
        shared: true,
        starred: false,
        description: 'Scenic mountain photo',
    },
    {
        name: 'Fish.png',
        asset: 'fish',
        folder: null,
        shared: false,
        starred: false,
        description: '',
    },
    {
        name: 'Funny Jokes.pdf',
        asset: 'funnyJokes',
        folder: null,
        shared: true,
        starred: true,
        description: 'A collection of jokes',
    },
    {
        name: 'Sample Document.docx',
        asset: 'docx',
        folder: null,
        shared: false,
        starred: false,
        description: '',
    },
    {
        name: 'Sample Spreadsheet.xlsx',
        asset: 'xlsx',
        folder: null,
        shared: false,
        starred: false,
        description: '',
    },
    {
        name: 'Sample Presentation.pptx',
        asset: 'pptx',
        folder: null,
        shared: false,
        starred: false,
        description: '',
    },
    {
        name: 'Welcome.pdf',
        folder: null,
        shared: false,
        starred: true,
        description: 'Getting started guide',
    },
    { name: 'Meeting Notes - All Hands.docx', folder: null, shared: true, starred: false, description: '' },
    { name: 'Vacation Plans 2026.docx', folder: null, shared: false, starred: false, description: '' },
    { name: 'Recipes.md', folder: null, shared: false, starred: true, description: 'Family recipes' },
    { name: 'Reading List.md', folder: null, shared: false, starred: false, description: '' },
    { name: 'Grocery List.txt', folder: null, shared: false, starred: false, description: '' },
    { name: 'Passwords (DO NOT SHARE).txt', folder: null, shared: false, starred: false, description: '' },
    { name: 'Annual Report 2025.pdf', folder: null, shared: true, starred: false, description: '' },
    { name: 'Investor Pitch.pptx', folder: null, shared: true, starred: true, description: '' },
    { name: 'Sales Forecast.xlsx', folder: null, shared: true, starred: false, description: '' },
    { name: 'Customer Feedback.xlsx', folder: null, shared: true, starred: false, description: '' },
    { name: 'Mockup - Landing Page.png', folder: null, shared: false, starred: false, description: '' },
    { name: 'Mockup - Dashboard v2.png', folder: null, shared: true, starred: false, description: '' },
    { name: 'Wireframe.svg', folder: null, shared: false, starred: false, description: '' },
    { name: 'Logo Final.svg', folder: null, shared: true, starred: false, description: '' },
    { name: 'Conference Talk.pptx', folder: null, shared: true, starred: false, description: '' },
    { name: 'Speaker Notes.docx', folder: null, shared: false, starred: false, description: '' },
    { name: 'Demo Recording.mp4', folder: null, shared: true, starred: false, description: '' },
    { name: 'Office Tour.mov', folder: null, shared: false, starred: false, description: '' },
    { name: 'Team Photo - Summer Offsite.jpg', folder: null, shared: true, starred: true, description: '' },
    { name: 'Whiteboard Snapshot.jpg', folder: null, shared: false, starred: false, description: '' },
    { name: 'Coffee Counter.gif', folder: null, shared: false, starred: false, description: '' },
    { name: 'Old Backup.zip', folder: null, shared: false, starred: false, description: '' },
    { name: 'Source Code Snapshot.tar.gz', folder: null, shared: false, starred: false, description: '' },
    { name: 'Database Dump.sql', folder: null, shared: false, starred: false, description: '' },
    { name: 'Deployment Notes.md', folder: null, shared: true, starred: false, description: '' },
    { name: 'Server Configuration.json', folder: null, shared: false, starred: false, description: '' },
    { name: 'API Tokens (rotate quarterly).json', folder: null, shared: false, starred: false, description: '' },
    { name: 'index.html', folder: null, shared: false, starred: false, description: '' },
    { name: 'styles.css', folder: null, shared: false, starred: false, description: '' },
    { name: 'analytics.js', folder: null, shared: false, starred: false, description: '' },
    { name: 'Podcast Episode 42.mp3', folder: null, shared: false, starred: false, description: '' },
    { name: 'Voice Memo - Brainstorm.mp3', folder: null, shared: false, starred: false, description: '' },
    { name: 'Soundtrack Idea.wav', folder: null, shared: false, starred: false, description: '' },
    { name: 'Keynote Audio.flac', folder: null, shared: false, starred: false, description: '' },
    { name: 'Business Cards.pdf', folder: null, shared: true, starred: false, description: '' },
    { name: 'NDA Template.pdf', folder: null, shared: true, starred: false, description: '' },
    { name: 'Vendor Quote - Acme.pdf', folder: null, shared: true, starred: false, description: '' },
    { name: 'Receipt - October.pdf', folder: null, shared: false, starred: false, description: '' },
    { name: 'Lease Agreement.pdf', folder: null, shared: false, starred: false, description: '' },
    { name: 'Headshots.zip', folder: null, shared: true, starred: false, description: '' },
    { name: 'Brand Assets.zip', folder: null, shared: true, starred: false, description: '' },
    { name: 'OKRs Q2.docx', folder: null, shared: true, starred: true, description: '' },
    { name: '1:1 Notes - Manager.docx', folder: null, shared: false, starred: false, description: '' },
    { name: 'Performance Review (Self).docx', folder: null, shared: false, starred: false, description: '' },
    { name: 'Hiring Plan.xlsx', folder: null, shared: true, starred: false, description: '' },
    { name: 'Interview Loop - Engineering.docx', folder: null, shared: true, starred: false, description: '' },
    { name: 'Offer Letter Template.docx', folder: null, shared: true, starred: false, description: '' },
    { name: 'Expense Report.csv', folder: null, shared: false, starred: false, description: '' },
    { name: 'Mileage Log.csv', folder: null, shared: false, starred: false, description: '' },
    { name: 'Inventory Count.csv', folder: null, shared: true, starred: false, description: '' },
    { name: 'Customer List Export.csv', folder: null, shared: false, starred: false, description: '' },
    { name: 'Holiday Schedule.txt', folder: null, shared: true, starred: false, description: '' },
    { name: 'TODO.txt', folder: null, shared: false, starred: false, description: '' },
    { name: 'README.md', folder: null, shared: false, starred: false, description: '' },
    { name: 'CHANGELOG.md', folder: null, shared: false, starred: false, description: '' },
    { name: 'LICENSE.txt', folder: null, shared: false, starred: false, description: '' },

    // Q1 Planning
    {
        name: 'Product Roadmap 2026.docx',
        asset: 'docx',
        folder: 'q1-planning',
        shared: true,
        starred: true,
        description: 'Full product roadmap for 2026',
    },
    {
        name: 'Q1 Budget.xlsx',
        asset: 'xlsx',
        folder: 'q1-planning',
        shared: true,
        starred: false,
        description: 'Quarterly budget breakdown',
    },
    {
        name: 'Strategy Deck.pptx',
        asset: 'pptx',
        folder: 'q1-planning',
        shared: true,
        starred: false,
        description: '',
    },

    // Marketing
    {
        name: 'Brand Guidelines.pdf',
        asset: 'pdf',
        folder: 'marketing',
        shared: true,
        starred: false,
        description: 'Official brand guide v3',
    },
    {
        name: 'Logo Variants.png',
        asset: 'png',
        folder: 'marketing',
        shared: false,
        starred: false,
        description: '',
    },
    {
        name: 'Social Media Plan.docx',
        asset: 'docx',
        folder: 'marketing',
        shared: true,
        starred: false,
        description: 'Q2 social media strategy',
    },

    // Engineering
    {
        name: 'Architecture Overview.docx',
        asset: 'docx',
        folder: 'engineering',
        shared: true,
        starred: false,
        description: 'System architecture and design decisions',
    },
    {
        name: 'System Diagram.png',
        asset: 'png',
        folder: 'engineering',
        shared: false,
        starred: true,
        description: '',
    },

    // API Documentation
    {
        name: 'API v2 Reference.pdf',
        asset: 'pdf',
        folder: 'api-docs',
        shared: true,
        starred: false,
        description: 'Complete API v2 documentation',
    },
    {
        name: 'API Usage Metrics.xlsx',
        asset: 'xlsx',
        folder: 'api-docs',
        shared: true,
        starred: false,
        description: '',
    },

    // Shared Documents
    {
        name: 'Team Meeting Notes.docx',
        asset: 'docx',
        folder: 'shared-docs',
        shared: true,
        starred: false,
        description: 'Weekly meeting notes',
    },
    {
        name: 'Team Roster.xlsx',
        asset: 'xlsx',
        folder: 'shared-docs',
        shared: true,
        starred: false,
        description: '',
    },
    {
        name: 'Onboarding Slides.pptx',
        asset: 'pptx',
        folder: 'shared-docs',
        shared: true,
        starred: true,
        description: 'New hire onboarding deck',
    },

    // Personal
    {
        name: 'Resume 2026.docx',
        asset: 'docx',
        folder: 'personal',
        shared: false,
        starred: false,
        description: '',
    },
    {
        name: 'Profile Photo.jpg',
        asset: 'jpg',
        folder: 'personal',
        shared: false,
        starred: false,
        description: '',
    },
    {
        name: 'Tax Documents 2025.pdf',
        asset: 'pdf',
        folder: 'personal',
        shared: false,
        starred: false,
        description: '',
    },

    // Archive
    {
        name: 'Client Proposal (Old).docx',
        asset: 'docx',
        folder: 'archive',
        shared: false,
        starred: false,
        description: '',
    },
    {
        name: '2025 Financials.xlsx',
        asset: 'xlsx',
        folder: 'archive',
        shared: true,
        starred: false,
        description: 'Annual financial summary',
    },
]

async function seedFolders(pb: PocketBase, orgId: string, userOrgId: string) {
    const folderIds: Record<string, string> = {}

    for (const folder of FOLDERS) {
        log(`Creating folder: ${folder.name}`)
        // The owner drive_shares row is created server-side by the
        // OnRecordCreate("drive_items") hook in drive/server/register.go;
        // no explicit follow-up share insert here.
        const record = await pb.collection('drive_items').create({
            org: orgId,
            name: folder.name,
            is_folder: true,
            mime_type: '',
            parent: folder.parent ? folderIds[folder.parent] : '',
            created_by: userOrgId,
            size: 0,
            description: '',
        })
        folderIds[folder.key] = record.id
    }

    return folderIds
}

async function seedFiles(
    pb: PocketBase,
    orgId: string,
    userOrgId: string,
    folderIds: Record<string, string>,
    otherMembers: { id: string }[]
) {
    for (const file of FILES) {
        log(`Uploading file: ${file.name}`)
        const parentId = file.folder ? folderIds[file.folder] : ''

        // The owner drive_shares row is created server-side by the
        // OnRecordCreate("drive_items") hook; non-owner shares (below)
        // still need to be created explicitly.
        let record: { id: string }
        if (file.asset) {
            const asset = loadAsset(file.asset)
            const formData = new FormData()
            formData.append('org', orgId)
            formData.append('name', file.name)
            formData.append('is_folder', 'false')
            formData.append('mime_type', asset.mime)
            formData.append('parent', parentId)
            formData.append('created_by', userOrgId)
            formData.append('size', String(asset.size))
            formData.append('description', file.description)
            formData.append('file', asset.blob, file.name)
            record = await pb.collection('drive_items').create(formData)
        } else {
            // Metadata-only seed file: no blob backing. Mime is derived
            // from the extension so the icon renders correctly.
            record = await pb.collection('drive_items').create({
                org: orgId,
                name: file.name,
                is_folder: false,
                mime_type: mimeForName(file.name),
                parent: parentId,
                created_by: userOrgId,
                size: 0,
                description: file.description,
            })
        }

        // Share with a team member if marked as shared
        if (file.shared && otherMembers.length > 0) {
            const sharedWith = otherMembers[Math.floor(Math.random() * otherMembers.length)]
            await pb.collection('drive_shares').create({
                item: record.id,
                user_org: sharedWith.id,
                role: 'editor',
                created_by: userOrgId,
            })
        }

        // Create item state for starred items
        if (file.starred) {
            await pb.collection('drive_item_state').create({
                item: record.id,
                user_org: userOrgId,
                is_starred: true,
                trashed_at: '',
                last_viewed_at: new Date().toISOString(),
            })
        }
    }
}

async function seedFolderStars(pb: PocketBase, userOrgId: string, folderIds: Record<string, string>) {
    // Star the Projects and Engineering folders
    const starredFolders = ['projects', 'engineering']
    for (const key of starredFolders) {
        if (folderIds[key]) {
            await pb.collection('drive_item_state').create({
                item: folderIds[key],
                user_org: userOrgId,
                is_starred: true,
                trashed_at: '',
                last_viewed_at: new Date().toISOString(),
            })
        }
    }
}

export default async function seed(pb: PocketBase, { org, userOrg }: SeedContext) {
    const existingItems = await pb.collection('drive_items').getList(1, 1, {
        filter: `org = "${org.id}"`,
    })
    if (existingItems.totalItems > 0) {
        log(`Skipping (${existingItems.totalItems} items already exist)`)
        return
    }

    const otherMembers = await pb.collection('user_org').getFullList({
        filter: `org = "${org.id}" && id != "${userOrg.id}"`,
    })

    const folderIds = await seedFolders(pb, org.id, userOrg.id)

    log(`Uploading ${FILES.length} files...`)
    await seedFiles(pb, org.id, userOrg.id, folderIds, otherMembers)

    await seedFolderStars(pb, userOrg.id, folderIds)

    log(`Created ${FOLDERS.length} folders and uploaded ${FILES.length} files`)
}
