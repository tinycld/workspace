import type { CoreStores } from '@tinycld/core/lib/pocketbase'
import type { Schema } from '@tinycld/core/types/pbSchema'
import type { createCollection } from 'pbtsdb/core'
import { BasicIndex } from 'pbtsdb/core'
import type { DriveSchema } from './types'

type MergedSchema = Schema & DriveSchema

export function registerCollections(
    newCollection: ReturnType<typeof createCollection<MergedSchema>>,
    coreStores: CoreStores
) {
    const drive_items = newCollection('drive_items', {
        omitOnInsert: ['created', 'updated', 'thumbnail'] as const,
        expand: { created_by: coreStores.user_org },
        // On-demand: each useLiveQuery against drive_items issues a server
        // fetch with the where/orderBy translated into a PocketBase filter.
        // Avoids loading every item in the org just to render a single folder.
        syncMode: 'on-demand' as const,
        collectionOptions: {
            autoIndex: 'eager' as const,
            defaultIndexType: BasicIndex,
        },
    })

    const drive_shares = newCollection('drive_shares', {
        omitOnInsert: ['created', 'updated'] as const,
        expand: {
            item: drive_items,
            user_org: coreStores.user_org,
            created_by: coreStores.user_org,
        },
        collectionOptions: {
            autoIndex: 'eager' as const,
            defaultIndexType: BasicIndex,
        },
    })

    const drive_item_state = newCollection('drive_item_state', {
        omitOnInsert: ['created', 'updated'] as const,
        expand: { item: drive_items, user_org: coreStores.user_org },
        collectionOptions: {
            autoIndex: 'eager' as const,
            defaultIndexType: BasicIndex,
        },
    })

    const drive_item_versions = newCollection('drive_item_versions', {
        omitOnInsert: ['created', 'updated'] as const,
        expand: { item: drive_items, created_by: coreStores.user_org },
        collectionOptions: {
            autoIndex: 'eager' as const,
            defaultIndexType: BasicIndex,
        },
    })

    const drive_share_links = newCollection('drive_share_links', {
        omitOnInsert: ['created', 'updated'] as const,
        expand: { item: drive_items, created_by: coreStores.user_org },
        collectionOptions: {
            autoIndex: 'eager' as const,
            defaultIndexType: BasicIndex,
        },
    })

    return {
        drive_items,
        drive_shares,
        drive_item_state,
        drive_item_versions,
        drive_share_links,
    }
}
