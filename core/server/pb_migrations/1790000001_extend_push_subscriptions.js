/// <reference path="../pb_data/types.d.ts" />
migrate(
    app => {
        const pushSubs = app.findCollectionByNameOrId('push_subscriptions')

        pushSubs.fields.addAt(
            pushSubs.fields.length,
            new Field({
                id: 'ps_platform',
                name: 'platform',
                type: 'select',
                required: true,
                values: ['web', 'expo'],
                maxSelect: 1,
            })
        )

        pushSubs.fields.addAt(
            pushSubs.fields.length,
            new Field({
                id: 'ps_expo_token',
                name: 'expo_token',
                type: 'text',
                max: 500,
            })
        )

        app.save(pushSubs)

        // Set existing records to platform = 'web'
        try {
            app.db()
                .newQuery("UPDATE push_subscriptions SET platform = 'web' WHERE platform = ''")
                .execute()
        } catch (e) {
            // ignore
        }
    },
    app => {
        const pushSubs = app.findCollectionByNameOrId('push_subscriptions')

        pushSubs.fields.removeById('ps_platform')
        pushSubs.fields.removeById('ps_expo_token')

        app.save(pushSubs)
    }
)
