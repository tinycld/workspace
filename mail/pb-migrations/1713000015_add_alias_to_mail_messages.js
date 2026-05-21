/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        const messages = app.findCollectionByNameOrId('mail_messages')
        const aliases = app.findCollectionByNameOrId('mail_mailbox_aliases')

        messages.fields.add(
            new Field({
                id: 'mail_messages_alias',
                name: 'alias',
                type: 'relation',
                required: false,
                collectionId: aliases.id,
                cascadeDelete: false,
                maxSelect: 1,
            })
        )

        app.save(messages)
    },
    app => {
        const messages = app.findCollectionByNameOrId('mail_messages')
        messages.fields.removeById('mail_messages_alias')
        app.save(messages)
    }
)
