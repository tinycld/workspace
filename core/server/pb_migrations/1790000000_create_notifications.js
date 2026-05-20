/// <reference path="../pb_data/types.d.ts" />
migrate(
    app => {
        const notifications = new Collection({
            id: 'pbc_notifications_01',
            name: 'notifications',
            type: 'base',
            system: false,
            listRule: 'user = @request.auth.id',
            viewRule: 'user = @request.auth.id',
            createRule: '@request.auth.id != "" && user = @request.auth.id',
            updateRule: 'user = @request.auth.id',
            deleteRule: 'user = @request.auth.id',
            fields: [
                {
                    id: 'notif_user',
                    name: 'user',
                    type: 'relation',
                    required: true,
                    collectionId: '_pb_users_auth_',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'notif_org',
                    name: 'org',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_orgs_00001',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'notif_type',
                    name: 'type',
                    type: 'text',
                    required: true,
                    max: 100,
                },
                {
                    id: 'notif_package',
                    name: 'package',
                    type: 'text',
                    max: 100,
                },
                {
                    id: 'notif_title',
                    name: 'title',
                    type: 'text',
                    required: true,
                    max: 200,
                },
                {
                    id: 'notif_body',
                    name: 'body',
                    type: 'text',
                    max: 1000,
                },
                {
                    id: 'notif_url',
                    name: 'url',
                    type: 'text',
                    max: 500,
                },
                {
                    id: 'notif_metadata',
                    name: 'metadata',
                    type: 'json',
                },
                {
                    id: 'notif_read',
                    name: 'read',
                    type: 'bool',
                },
                {
                    id: 'notif_dismissed',
                    name: 'dismissed',
                    type: 'bool',
                },
                {
                    id: 'notif_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'notif_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE INDEX `idx_notif_user` ON `notifications` (`user`, `read`, `created`)',
                'CREATE INDEX `idx_notif_org` ON `notifications` (`org`)',
            ],
        })
        app.save(notifications)
    },
    app => {
        try {
            const c = app.findCollectionByNameOrId('notifications')
            app.delete(c)
        } catch (e) {
            // may not exist
        }
    }
)
