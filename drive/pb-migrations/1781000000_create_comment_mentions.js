/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        // Shared table for @mention rows across every package's
        // comments collection (calc_comments, text_comments, ...). One
        // row per (commentRecord, mentionedUser). The Go notify hook
        // (in @tinycld/core/server/notify) observes inserts and fires
        // NotifyUser; clients never read this collection directly —
        // they read notifications. Hence listRule/viewRule = null
        // (system-only).
        //
        // Lives in @tinycld/drive (not core) because the createRule
        // authorizes through the drive_item relation, and the rule
        // parser requires the target collection (pbc_drive_items_01)
        // to exist at migration time. Hosts that don't link drive
        // won't have mentions either — that's by design: the entire
        // comments-with-mentions feature is gated on documents being
        // stored as drive items.
        //
        // comment_collection / comment_record are stored as plain text
        // rather than a polymorphic relation because PB doesn't model
        // polymorphism. The Go hook validates `comment_collection`
        // against an allowlist before notifying so an attacker who
        // manages to insert a row with a bogus collection name is
        // silently dropped on the server.
        //
        // drive_item is denormalized onto every mention row so the
        // createRule can authorize without crossing a polymorphic
        // join — the same drive_shares_via_item rule used by every
        // comments table flows through here.
        const commentMentions = new Collection({
            id: 'pbc_comment_mentions_01',
            name: 'comment_mentions',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'cm_comment_collection',
                    name: 'comment_collection',
                    type: 'text',
                    required: true,
                    max: 64,
                },
                {
                    id: 'cm_comment_record',
                    name: 'comment_record',
                    type: 'text',
                    required: true,
                    max: 32,
                },
                {
                    id: 'cm_drive_item',
                    name: 'drive_item',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_drive_items_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'cm_mentioned_user_org',
                    name: 'mentioned_user_org',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_user_org_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'cm_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
            ],
            // Clients can insert when they have share access to the
            // parent drive_item — same gate as the comments tables.
            // The collection is otherwise opaque from the client side:
            // list/view/update/delete are nulled (system-only).
            listRule: null,
            viewRule: null,
            createRule:
                '@request.auth.id != "" && drive_item.drive_shares_via_item.user_org.user ?= @request.auth.id',
            updateRule: null,
            deleteRule: null,
            indexes: [
                'CREATE INDEX `idx_comment_mentions_target` ON `comment_mentions` (`comment_collection`, `comment_record`)',
                'CREATE INDEX `idx_comment_mentions_user` ON `comment_mentions` (`mentioned_user_org`, `created` DESC)',
            ],
        })
        app.save(commentMentions)
    },
    app => {
        const collection = app.findCollectionByNameOrId('comment_mentions')
        app.delete(collection)
    }
)
