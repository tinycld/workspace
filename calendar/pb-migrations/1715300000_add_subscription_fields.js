/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        const calendars = app.findCollectionByNameOrId('calendar_calendars')

        calendars.fields.addAt(
            calendars.fields.length,
            new Field({
                id: 'cal_subscription_url',
                name: 'subscription_url',
                type: 'url',
                required: false,
                maxSize: 2000,
            })
        )

        calendars.fields.addAt(
            calendars.fields.length,
            new Field({
                id: 'cal_subscription_last_sync',
                name: 'subscription_last_sync',
                type: 'date',
                required: false,
            })
        )

        calendars.fields.addAt(
            calendars.fields.length,
            new Field({
                id: 'cal_subscription_error',
                name: 'subscription_error',
                type: 'text',
                required: false,
                maxSize: 500,
            })
        )

        calendars.indexes = calendars.indexes || []
        calendars.indexes.push(
            'CREATE INDEX idx_cal_subscription_url ON calendar_calendars (subscription_url) WHERE subscription_url != ""'
        )

        app.save(calendars)
    },
    app => {
        const calendars = app.findCollectionByNameOrId('calendar_calendars')

        calendars.fields.removeById('cal_subscription_url')
        calendars.fields.removeById('cal_subscription_last_sync')
        calendars.fields.removeById('cal_subscription_error')

        calendars.indexes = (calendars.indexes || []).filter(
            idx => !idx.includes('idx_cal_subscription_url')
        )

        app.save(calendars)
    }
)
