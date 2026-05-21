/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        const messages = app.findCollectionByNameOrId('mail_messages')

        messages.fields.add(
            new Field({
                id: 'mail_messages_cid_map',
                name: 'cid_map',
                type: 'json',
                maxSize: 100000,
            })
        )

        app.save(messages)
    },
    app => {
        const messages = app.findCollectionByNameOrId('mail_messages')
        messages.fields.removeById('mail_messages_cid_map')
        app.save(messages)
    }
)
