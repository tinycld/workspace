/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        const collection = new Collection({
            id: 'pbc_contacts_01',
            name: 'contacts',
            type: 'base',
            system: false,
            listRule: 'owner.user = @request.auth.id',
            viewRule: 'owner.user = @request.auth.id',
            createRule: 'owner.user = @request.auth.id',
            updateRule: 'owner.user = @request.auth.id',
            deleteRule: 'owner.user = @request.auth.id',
            fields: [
                {
                    id: 'contacts_name',
                    name: 'name',
                    type: 'text',
                    required: true,
                    min: 1,
                    max: 200,
                },
                {
                    id: 'contacts_email',
                    name: 'email',
                    type: 'email',
                    required: false,
                },
                {
                    id: 'contacts_phone',
                    name: 'phone',
                    type: 'text',
                    required: false,
                    max: 50,
                },
                {
                    id: 'contacts_owner',
                    name: 'owner',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_user_org_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'contacts_notes',
                    name: 'notes',
                    type: 'editor',
                    required: false,
                },
                {
                    id: 'contacts_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'contacts_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE INDEX `idx_contacts_owner` ON `contacts` (`owner`)',
                'CREATE INDEX `idx_contacts_name` ON `contacts` (`name`)',
            ],
        })

        return app.save(collection)
    },
    app => {
        const collection = app.findCollectionByNameOrId('contacts')
        return app.delete(collection)
    }
)
