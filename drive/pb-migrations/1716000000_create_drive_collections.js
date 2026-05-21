/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        // Phase 1: Create all collections without access rules

        // 1. drive_items — files and folders (created without self-referencing `parent` field)
        const items = new Collection({
            id: 'pbc_drive_items_01',
            name: 'drive_items',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'drv_items_org',
                    name: 'org',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_orgs_00001',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'drv_items_name',
                    name: 'name',
                    type: 'text',
                    required: true,
                    min: 1,
                    max: 500,
                },
                {
                    id: 'drv_items_is_folder',
                    name: 'is_folder',
                    type: 'bool',
                },
                {
                    id: 'drv_items_mime_type',
                    name: 'mime_type',
                    type: 'text',
                    required: false,
                    max: 255,
                },
                {
                    id: 'drv_items_created_by',
                    name: 'created_by',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_user_org_01',
                    cascadeDelete: false,
                    maxSelect: 1,
                },
                {
                    id: 'drv_items_size',
                    name: 'size',
                    type: 'number',
                    required: false,
                    min: 0,
                },
                {
                    id: 'drv_items_file',
                    name: 'file',
                    type: 'file',
                    required: false,
                    maxSelect: 1,
                    maxSize: 104857600,
                },
                {
                    id: 'drv_items_description',
                    name: 'description',
                    type: 'text',
                    required: false,
                    max: 2000,
                },
                {
                    id: 'drv_items_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'drv_items_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE INDEX `idx_drv_items_org` ON `drive_items` (`org`)',
                'CREATE INDEX `idx_drv_items_created_by` ON `drive_items` (`created_by`)',
                'CREATE INDEX `idx_drv_items_org_updated` ON `drive_items` (`org`, `updated` DESC)',
            ],
        })
        app.save(items)

        // Add self-referencing parent field now that the collection exists
        const itemsWithParent = app.findCollectionByNameOrId('drive_items')
        itemsWithParent.fields.add(
            new Field({
                id: 'drv_items_parent',
                name: 'parent',
                type: 'relation',
                required: false,
                collectionId: 'pbc_drive_items_01',
                cascadeDelete: true,
                maxSelect: 1,
            })
        )
        itemsWithParent.indexes = [
            'CREATE INDEX `idx_drv_items_org` ON `drive_items` (`org`)',
            'CREATE INDEX `idx_drv_items_org_parent` ON `drive_items` (`org`, `parent`)',
            'CREATE INDEX `idx_drv_items_created_by` ON `drive_items` (`created_by`)',
            'CREATE INDEX `idx_drv_items_org_updated` ON `drive_items` (`org`, `updated` DESC)',
        ]
        app.save(itemsWithParent)

        // 2. drive_shares — per-item access control
        const shares = new Collection({
            id: 'pbc_drive_shares_01',
            name: 'drive_shares',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'drv_shares_item',
                    name: 'item',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_drive_items_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'drv_shares_user_org',
                    name: 'user_org',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_user_org_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'drv_shares_role',
                    name: 'role',
                    type: 'select',
                    required: true,
                    values: ['owner', 'editor', 'viewer'],
                    maxSelect: 1,
                },
                {
                    id: 'drv_shares_created_by',
                    name: 'created_by',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_user_org_01',
                    cascadeDelete: false,
                    maxSelect: 1,
                },
                {
                    id: 'drv_shares_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'drv_shares_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX `idx_drv_shares_unique` ON `drive_shares` (`item`, `user_org`)',
                'CREATE INDEX `idx_drv_shares_item` ON `drive_shares` (`item`)',
                'CREATE INDEX `idx_drv_shares_user_org` ON `drive_shares` (`user_org`)',
                'CREATE INDEX `idx_drv_shares_user_org_role` ON `drive_shares` (`user_org`, `role`)',
            ],
        })
        app.save(shares)

        // 3. drive_item_state — per-user state (starred, trash, recent)
        const itemState = new Collection({
            id: 'pbc_drive_state_01',
            name: 'drive_item_state',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'drv_state_item',
                    name: 'item',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_drive_items_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'drv_state_user_org',
                    name: 'user_org',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_user_org_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'drv_state_is_starred',
                    name: 'is_starred',
                    type: 'bool',
                },
                {
                    id: 'drv_state_trashed_at',
                    name: 'trashed_at',
                    type: 'date',
                    required: false,
                },
                {
                    id: 'drv_state_last_viewed_at',
                    name: 'last_viewed_at',
                    type: 'date',
                    required: false,
                },
                {
                    id: 'drv_state_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'drv_state_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX `idx_drv_state_unique` ON `drive_item_state` (`item`, `user_org`)',
                'CREATE INDEX `idx_drv_state_starred` ON `drive_item_state` (`user_org`, `is_starred`)',
                'CREATE INDEX `idx_drv_state_trashed` ON `drive_item_state` (`user_org`, `trashed_at`)',
                'CREATE INDEX `idx_drv_state_recent` ON `drive_item_state` (`user_org`, `last_viewed_at` DESC)',
            ],
        })
        app.save(itemState)

        // Phase 2: Apply access rules now that all collections exist and back-relations resolve

        function setRules(collection, { list, view, create, update, del }) {
            collection.listRule = list
            collection.viewRule = view
            collection.createRule = create
            collection.updateRule = update
            collection.deleteRule = del
        }

        const hasShareRule = 'drive_shares_via_item.user_org.user ?= @request.auth.id'
        const isOwnerOrEditor =
            'drive_shares_via_item.user_org.user ?= @request.auth.id && drive_shares_via_item.role ?!= "viewer"'
        const isOwner =
            'drive_shares_via_item.user_org.user ?= @request.auth.id && drive_shares_via_item.role ?= "owner"'
        const orgMemberRule = 'org.user_org_via_org.user ?= @request.auth.id'
        const ownRecordRule = 'user_org.user = @request.auth.id'
        const ownShareRecipient = 'user_org.user = @request.auth.id'
        const isItemOwner =
            'item.drive_shares_via_item.user_org.user ?= @request.auth.id && item.drive_shares_via_item.role ?= "owner"'

        // drive_items: viewable by share holders, creatable by org members, editable by owner/editor, deletable by owner
        const itemsCol = app.findCollectionByNameOrId('drive_items')
        setRules(itemsCol, {
            list: hasShareRule,
            view: hasShareRule,
            create: orgMemberRule,
            update: isOwnerOrEditor,
            del: isOwner,
        })
        app.save(itemsCol)

        // drive_shares: viewable by share recipient, manageable by item owner
        const sharesCol = app.findCollectionByNameOrId('drive_shares')
        setRules(sharesCol, {
            list: ownShareRecipient,
            view: ownShareRecipient,
            create: isItemOwner,
            update: isItemOwner,
            del: `${ownShareRecipient} || ${isItemOwner}`,
        })
        app.save(sharesCol)

        // drive_item_state: own records only, create requires a share on the item
        const stateCol = app.findCollectionByNameOrId('drive_item_state')
        setRules(stateCol, {
            list: ownRecordRule,
            view: ownRecordRule,
            create: `${ownRecordRule} && item.drive_shares_via_item.user_org.user ?= @request.auth.id`,
            update: ownRecordRule,
            del: ownRecordRule,
        })
        app.save(stateCol)
    },
    app => {
        const collections = ['drive_item_state', 'drive_shares', 'drive_items']
        for (const name of collections) {
            const collection = app.findCollectionByNameOrId(name)
            app.delete(collection)
        }
    }
)
