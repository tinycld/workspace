/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        const collection = app.findCollectionByNameOrId('contacts')

        collection.fields.add(
            new DateField({
                name: 'deleted_at',
                required: false,
            })
        )

        collection.indexes = [
            ...collection.indexes,
            'CREATE INDEX `idx_contacts_deleted_at` ON `contacts` (`deleted_at`)',
        ]

        app.save(collection)
    },
    app => {
        const collection = app.findCollectionByNameOrId('contacts')

        collection.fields.removeByName('deleted_at')

        collection.indexes = collection.indexes.filter(
            idx => !idx.includes('idx_contacts_deleted_at')
        )

        app.save(collection)
    }
)
