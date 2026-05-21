/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        const versions = new Collection({
            id: 'pbc_drive_versions_01',
            name: 'drive_item_versions',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'drv_ver_item',
                    name: 'item',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_drive_items_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'drv_ver_version_number',
                    name: 'version_number',
                    type: 'number',
                    required: true,
                    min: 1,
                },
                {
                    id: 'drv_ver_file',
                    name: 'file',
                    type: 'file',
                    required: false,
                    maxSelect: 1,
                    maxSize: 104857600,
                },
                {
                    id: 'drv_ver_size',
                    name: 'size',
                    type: 'number',
                    required: false,
                    min: 0,
                },
                {
                    id: 'drv_ver_mime_type',
                    name: 'mime_type',
                    type: 'text',
                    required: false,
                    max: 255,
                },
                {
                    id: 'drv_ver_source',
                    name: 'source',
                    type: 'select',
                    required: true,
                    values: ['upload', 'system'],
                    maxSelect: 1,
                },
                {
                    id: 'drv_ver_label',
                    name: 'label',
                    type: 'text',
                    required: false,
                    max: 500,
                },
                {
                    id: 'drv_ver_created_by',
                    name: 'created_by',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_user_org_01',
                    cascadeDelete: false,
                    maxSelect: 1,
                },
                {
                    id: 'drv_ver_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'drv_ver_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE INDEX `idx_drv_ver_item` ON `drive_item_versions` (`item`)',
                'CREATE UNIQUE INDEX `idx_drv_ver_unique` ON `drive_item_versions` (`item`, `version_number`)',
            ],
        })
        app.save(versions)

        const hasShareRule = 'item.drive_shares_via_item.user_org.user ?= @request.auth.id'
        const isOwnerOrEditor =
            'item.drive_shares_via_item.user_org.user ?= @request.auth.id && item.drive_shares_via_item.role ?!= "viewer"'
        const isOwner =
            'item.drive_shares_via_item.user_org.user ?= @request.auth.id && item.drive_shares_via_item.role ?= "owner"'

        const versionsCol = app.findCollectionByNameOrId('drive_item_versions')
        versionsCol.listRule = hasShareRule
        versionsCol.viewRule = hasShareRule
        versionsCol.createRule = isOwnerOrEditor
        versionsCol.updateRule = isOwnerOrEditor
        versionsCol.deleteRule = isOwner
        app.save(versionsCol)
    },
    app => {
        const collection = app.findCollectionByNameOrId('drive_item_versions')
        app.delete(collection)
    }
)
