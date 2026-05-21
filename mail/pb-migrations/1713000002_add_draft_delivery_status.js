/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        const collection = app.findCollectionByNameOrId('mail_messages')

        const field = collection.fields.find(f => f.name === 'delivery_status')
        if (field) {
            field.values = ['sending', 'sent', 'delivered', 'bounced', 'spam_complaint', 'draft']
            app.save(collection)
        }
    },
    app => {
        const collection = app.findCollectionByNameOrId('mail_messages')

        const field = collection.fields.find(f => f.name === 'delivery_status')
        if (field) {
            field.values = ['sending', 'sent', 'delivered', 'bounced', 'spam_complaint']
            app.save(collection)
        }
    }
)
