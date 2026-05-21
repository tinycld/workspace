/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        const collection = app.findCollectionByNameOrId('mail_messages')

        collection.fields.push(
            new Field({
                id: 'mail_msg_delivery_status',
                name: 'delivery_status',
                type: 'select',
                required: false,
                values: ['sending', 'sent', 'delivered', 'bounced', 'spam_complaint'],
            })
        )

        collection.fields.push(
            new Field({
                id: 'mail_msg_bounce_reason',
                name: 'bounce_reason',
                type: 'text',
                required: false,
                max: 500,
            })
        )

        app.save(collection)
    },
    app => {
        const collection = app.findCollectionByNameOrId('mail_messages')

        collection.fields.removeById('mail_msg_delivery_status')
        collection.fields.removeById('mail_msg_bounce_reason')

        app.save(collection)
    }
)
