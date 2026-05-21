/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        const messages = app.findCollectionByNameOrId('mail_messages')

        messages.fields.add(
            new Field({
                id: 'mail_messages_total_size',
                name: 'total_size',
                type: 'number',
                required: false,
                min: 0,
            })
        )

        app.save(messages)
    },
    app => {
        const messages = app.findCollectionByNameOrId('mail_messages')
        messages.fields.removeById('mail_messages_total_size')
        app.save(messages)
    }
)
