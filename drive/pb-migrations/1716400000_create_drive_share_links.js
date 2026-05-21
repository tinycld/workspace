/// <reference path="../../../server/pb_data/types.d.ts" />

migrate(
    app => {
        const shareLinks = new Collection({
            id: 'pbc_drive_share_links_01',
            name: 'drive_share_links',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'drv_sl_item',
                    name: 'item',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_drive_items_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'drv_sl_token',
                    name: 'token',
                    type: 'text',
                    required: true,
                    min: 64,
                    max: 64,
                },
                {
                    id: 'drv_sl_created_by',
                    name: 'created_by',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_user_org_01',
                    cascadeDelete: false,
                    maxSelect: 1,
                },
                {
                    id: 'drv_sl_role',
                    name: 'role',
                    type: 'select',
                    required: true,
                    values: ['viewer', 'editor'],
                    maxSelect: 1,
                },
                {
                    id: 'drv_sl_expires_at',
                    name: 'expires_at',
                    type: 'date',
                    required: false,
                },
                {
                    id: 'drv_sl_is_active',
                    name: 'is_active',
                    type: 'bool',
                },
                {
                    id: 'drv_sl_download_count',
                    name: 'download_count',
                    type: 'number',
                    required: false,
                    min: 0,
                },
                {
                    id: 'drv_sl_last_accessed_at',
                    name: 'last_accessed_at',
                    type: 'date',
                    required: false,
                },
                {
                    id: 'drv_sl_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'drv_sl_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX `idx_drv_sl_token` ON `drive_share_links` (`token`)',
                'CREATE INDEX `idx_drv_sl_item` ON `drive_share_links` (`item`)',
                'CREATE INDEX `idx_drv_sl_created_by` ON `drive_share_links` (`created_by`)',
            ],
        })
        app.save(shareLinks)

        // Access rules: all CRUD requires auth + item ownership
        const isItemOwner =
            'item.drive_shares_via_item.user_org.user ?= @request.auth.id && item.drive_shares_via_item.role ?= "owner"'

        const col = app.findCollectionByNameOrId('drive_share_links')
        col.listRule = isItemOwner
        col.viewRule = isItemOwner
        col.createRule = isItemOwner
        col.updateRule = isItemOwner
        col.deleteRule = isItemOwner
        app.save(col)
    },
    app => {
        const collection = app.findCollectionByNameOrId('drive_share_links')
        app.delete(collection)
    }
)
