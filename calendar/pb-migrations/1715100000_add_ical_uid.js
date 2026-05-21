/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        const collection = app.findCollectionByNameOrId('calendar_events')

        collection.fields.addAt(
            collection.fields.length,
            new Field({
                id: 'cal_events_ical_uid',
                name: 'ical_uid',
                type: 'text',
                required: false,
                max: 500,
            })
        )

        collection.indexes = [
            ...collection.indexes,
            'CREATE UNIQUE INDEX `idx_cal_events_ical_uid` ON `calendar_events` (`ical_uid`) WHERE `ical_uid` != ""',
        ]

        app.save(collection)
    },
    app => {
        const collection = app.findCollectionByNameOrId('calendar_events')

        collection.fields.removeById('cal_events_ical_uid')

        collection.indexes = collection.indexes.filter(
            idx => !idx.includes('idx_cal_events_ical_uid')
        )

        app.save(collection)
    }
)
