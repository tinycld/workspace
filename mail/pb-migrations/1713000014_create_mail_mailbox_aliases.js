/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        const aliases = new Collection({
            id: 'pbc_mail_aliases_01',
            name: 'mail_mailbox_aliases',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'mail_aliases_mailbox',
                    name: 'mailbox',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_mail_mailboxes_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'mail_aliases_address',
                    name: 'address',
                    type: 'text',
                    required: true,
                    min: 1,
                    max: 64,
                    pattern: '^[a-z0-9._-]+$',
                },
                {
                    id: 'mail_aliases_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'mail_aliases_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX `idx_mail_aliases_mailbox_address` ON `mail_mailbox_aliases` (`mailbox`, `address`)',
                'CREATE INDEX `idx_mail_aliases_address` ON `mail_mailbox_aliases` (`address`)',
            ],
            listRule:
                '@request.auth.id != "" && mailbox.domain.org.user_org_via_org.user ?= @request.auth.id',
            viewRule:
                '@request.auth.id != "" && mailbox.domain.org.user_org_via_org.user ?= @request.auth.id',
            createRule:
                '@request.auth.id != "" && mailbox.domain.org.user_org_via_org.user ?= @request.auth.id && (mailbox.domain.org.user_org_via_org.role ?= "admin" || mailbox.domain.org.user_org_via_org.role ?= "owner")',
            updateRule:
                '@request.auth.id != "" && mailbox.domain.org.user_org_via_org.user ?= @request.auth.id && (mailbox.domain.org.user_org_via_org.role ?= "admin" || mailbox.domain.org.user_org_via_org.role ?= "owner")',
            deleteRule:
                '@request.auth.id != "" && mailbox.domain.org.user_org_via_org.user ?= @request.auth.id && (mailbox.domain.org.user_org_via_org.role ?= "admin" || mailbox.domain.org.user_org_via_org.role ?= "owner")',
        })
        app.save(aliases)
    },
    app => {
        const aliases = app.findCollectionByNameOrId('mail_mailbox_aliases')
        app.delete(aliases)
    }
)
