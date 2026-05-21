/// <reference path="../../../server/pb_data/types.d.ts" />

migrate(
    app => {
        const collection = app.findCollectionByNameOrId('drive_items')

        collection.fields.addAt(
            collection.fields.length,
            new Field({
                type: 'file',
                name: 'thumbnail',
                maxSelect: 1,
                maxSize: 5242880,
                mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
            })
        )

        return app.save(collection)
    },
    app => {
        const collection = app.findCollectionByNameOrId('drive_items')
        collection.fields.removeByName('thumbnail')
        return app.save(collection)
    }
)
