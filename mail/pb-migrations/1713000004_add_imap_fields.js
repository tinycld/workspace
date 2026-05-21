/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        // Add imap_uid and raw_headers fields to mail_messages
        const messages = app.findCollectionByNameOrId('mail_messages')

        messages.fields.add(
            new Field({
                id: 'mail_messages_imap_uid',
                name: 'imap_uid',
                type: 'number',
                required: false,
                min: 0,
            })
        )

        messages.fields.add(
            new Field({
                id: 'mail_messages_raw_headers',
                name: 'raw_headers',
                type: 'file',
                required: false,
                maxSelect: 1,
                maxSize: 1048576,
                mimeTypes: ['text/plain', 'application/octet-stream'],
            })
        )

        // Add index for UID lookups within a mailbox (thread gives mailbox scope)
        messages.indexes.push(
            'CREATE INDEX `idx_mail_messages_thread_uid` ON `mail_messages` (`thread`, `imap_uid`)'
        )

        app.save(messages)

        // Create mail_imap_mailbox_state collection
        const mbState = new Collection({
            id: 'pbc_mail_imap_mb_st_01',
            name: 'mail_imap_mailbox_state',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'imap_mb_st_mailbox',
                    name: 'mailbox',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_mail_mailboxes_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'imap_mb_st_uid_validity',
                    name: 'uid_validity',
                    type: 'number',
                    required: true,
                    min: 1,
                },
                {
                    id: 'imap_mb_st_uid_next',
                    name: 'uid_next',
                    type: 'number',
                    required: true,
                    min: 1,
                },
                {
                    id: 'imap_mb_st_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'imap_mb_st_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX `idx_imap_mb_state_mailbox` ON `mail_imap_mailbox_state` (`mailbox`)',
            ],
        })
        app.save(mbState)

        // No API rules needed — accessed only via Go hooks, not client API
    },
    app => {
        // Remove mail_imap_mailbox_state collection
        const mbState = app.findCollectionByNameOrId('mail_imap_mailbox_state')
        app.delete(mbState)

        // Remove imap fields from mail_messages
        const messages = app.findCollectionByNameOrId('mail_messages')
        messages.fields.removeById('mail_messages_imap_uid')
        messages.fields.removeById('mail_messages_raw_headers')
        // Remove the index
        messages.indexes = messages.indexes.filter(
            idx => !idx.includes('idx_mail_messages_thread_uid')
        )
        app.save(messages)
    }
)
