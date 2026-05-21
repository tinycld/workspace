/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        const messages = app.findCollectionByNameOrId('mail_messages')

        messages.fields.add(
            new Field({
                id: 'mail_messages_attachment_thumbnails',
                name: 'attachment_thumbnails',
                type: 'file',
                required: false,
                maxSelect: 20,
                maxSize: 1048576, // 1 MB per generated thumbnail is plenty
                mimeTypes: ['image/jpeg'],
            })
        )

        messages.fields.add(
            new Field({
                id: 'mail_messages_attachment_thumbnail_map',
                name: 'attachment_thumbnail_map',
                type: 'json',
                maxSize: 100000,
            })
        )

        app.save(messages)
    },
    app => {
        const messages = app.findCollectionByNameOrId('mail_messages')
        messages.fields.removeById('mail_messages_attachment_thumbnail_map')
        messages.fields.removeById('mail_messages_attachment_thumbnails')
        app.save(messages)
    }
)
