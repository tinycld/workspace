/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        const collection = app.findCollectionByNameOrId('drive_items')
        collection.indexes = collection.indexes.concat([
            'CREATE UNIQUE INDEX `idx_drv_items_unique_name` ON `drive_items` (`org`, `parent`, `name`)',
        ])
        app.save(collection)
    },
    app => {
        const collection = app.findCollectionByNameOrId('drive_items')
        collection.indexes = collection.indexes.filter(
            idx => !idx.includes('idx_drv_items_unique_name')
        )
        app.save(collection)
    }
)
