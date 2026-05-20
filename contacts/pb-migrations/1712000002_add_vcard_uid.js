/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        const collection = app.findCollectionByNameOrId('contacts')

        collection.fields.add(new TextField({ name: 'vcard_uid', required: false, max: 255 }))

        collection.indexes = [
            ...collection.indexes,
            "CREATE UNIQUE INDEX `idx_contacts_vcard_uid` ON `contacts` (`vcard_uid`) WHERE `vcard_uid` != ''",
        ]

        app.save(collection)

        // Backfill existing contacts with a urn:uuid: value
        const records = app.findRecordsByFilter('contacts', '1=1')
        for (const record of records) {
            if (!record.get('vcard_uid')) {
                record.set(
                    'vcard_uid',
                    'urn:uuid:' +
                        $security.randomStringByRegex(
                            '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
                        )
                )
                app.save(record)
            }
        }
    },
    app => {
        const collection = app.findCollectionByNameOrId('contacts')

        collection.fields.removeByName('vcard_uid')

        collection.indexes = collection.indexes.filter(
            idx => !idx.includes('idx_contacts_vcard_uid')
        )

        app.save(collection)
    }
)
