import type { CoreStores } from '@tinycld/core/lib/pocketbase'
import type { Schema } from '@tinycld/core/types/pbSchema'
import type { createCollection } from 'pbtsdb/core'
import { BasicIndex } from 'pbtsdb/core'
import type { TextSchema } from './types'

type MergedSchema = Schema & TextSchema

export function registerCollections(
    newCollection: ReturnType<typeof createCollection<MergedSchema>>,
    coreStores: CoreStores
) {
    const text_comments = newCollection('text_comments', {
        omitOnInsert: ['created', 'updated'] as const,
        expand: { author: coreStores.user_org },
        collectionOptions: {
            autoIndex: 'eager' as const,
            defaultIndexType: BasicIndex,
        },
    })
    return { text_comments }
}
