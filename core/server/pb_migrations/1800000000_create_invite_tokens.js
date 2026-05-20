/// <reference path="../pb_data/types.d.ts" />
migrate(
    app => {
        const inviteTokens = new Collection({
            id: 'pbc_invite_tokens_01',
            name: 'invite_tokens',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'invite_tokens_token',
                    name: 'token',
                    type: 'text',
                    required: true,
                    min: 64,
                    max: 64,
                },
                {
                    id: 'invite_tokens_user',
                    name: 'user',
                    type: 'relation',
                    required: true,
                    collectionId: '_pb_users_auth_',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'invite_tokens_org',
                    name: 'org',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_orgs_00001',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'invite_tokens_role',
                    name: 'role',
                    type: 'text',
                    required: true,
                    max: 40,
                },
                {
                    id: 'invite_tokens_expires_at',
                    name: 'expires_at',
                    type: 'date',
                    required: true,
                },
                {
                    id: 'invite_tokens_used_at',
                    name: 'used_at',
                    type: 'date',
                    required: false,
                },
                {
                    id: 'invite_tokens_created_by',
                    name: 'created_by',
                    type: 'relation',
                    required: false,
                    collectionId: '_pb_users_auth_',
                    cascadeDelete: false,
                    maxSelect: 1,
                },
                {
                    id: 'invite_tokens_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'invite_tokens_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX `idx_invite_tokens_token` ON `invite_tokens` (`token`)',
                'CREATE INDEX `idx_invite_tokens_user` ON `invite_tokens` (`user`)',
                'CREATE INDEX `idx_invite_tokens_org` ON `invite_tokens` (`org`)',
            ],
        })

        // Access rules intentionally left empty (null) — only Go endpoints
        // (running as superuser) may read/write. Tokens must not be enumerable
        // by authenticated users, and acceptance happens through /api/accept-invite.
        app.save(inviteTokens)
    },
    app => {
        const collection = app.findCollectionByNameOrId('invite_tokens')
        app.delete(collection)
    }
)
