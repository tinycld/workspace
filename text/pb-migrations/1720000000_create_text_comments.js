/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        // Phase 1: create the collection WITHOUT the self-referencing
        // parent_comment field — PB rejects a relation whose
        // collectionId points at a collection that doesn't yet exist.
        // Same two-pass shape as calc_comments + drive_items.
        const textComments = new Collection({
            id: 'pbc_text_comments_01',
            name: 'text_comments',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'tc_drive_item',
                    name: 'drive_item',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_drive_items_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                // The Tiptap mark's `commentId` attribute. Survives
                // concurrent edits via the prosemirror-y bridge; the
                // PB row tracks anchor identity, not position.
                {
                    id: 'tc_comment_id',
                    name: 'comment_id',
                    type: 'text',
                    required: true,
                    max: 64,
                },
                // Snapshot of the anchored text at insert time.
                // Rendered in the drawer when the anchor is orphaned
                // so the reader sees what the comment was about.
                {
                    id: 'tc_quoted_text',
                    name: 'quoted_text',
                    type: 'text',
                    required: false,
                    max: 280,
                },
                {
                    id: 'tc_body',
                    name: 'body',
                    type: 'text',
                    required: true,
                    min: 1,
                    max: 4000,
                },
                {
                    id: 'tc_resolved_at',
                    name: 'resolved_at',
                    type: 'date',
                    required: false,
                },
                {
                    id: 'tc_author',
                    name: 'author',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_user_org_01',
                    cascadeDelete: false,
                    maxSelect: 1,
                },
                {
                    id: 'tc_author_name',
                    name: 'author_name',
                    type: 'text',
                    required: true,
                    max: 200,
                },
                {
                    id: 'tc_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'tc_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            // Mirror calc_comments + drive_items: anyone with a
            // drive_shares row for the parent drive_item can read/write
            // comments; only the author can update or delete their own.
            listRule:
                '@request.auth.id != "" && drive_item.drive_shares_via_item.user_org.user ?= @request.auth.id',
            viewRule:
                '@request.auth.id != "" && drive_item.drive_shares_via_item.user_org.user ?= @request.auth.id',
            createRule:
                '@request.auth.id != "" && drive_item.drive_shares_via_item.user_org.user ?= @request.auth.id && author.user = @request.auth.id',
            updateRule: '@request.auth.id != "" && author.user = @request.auth.id',
            deleteRule: '@request.auth.id != "" && author.user = @request.auth.id',
        })
        app.save(textComments)

        // Phase 2: add the self-referencing parent_comment field now
        // that the collection exists. Cascade direction: PB cascades
        // on the *target* of the relation, so deleting a root cascades
        // to every reply pointing at it (kills the whole thread).
        const withParent = app.findCollectionByNameOrId('text_comments')
        withParent.fields.add(
            new Field({
                id: 'tc_parent_comment',
                name: 'parent_comment',
                type: 'relation',
                required: false,
                collectionId: 'pbc_text_comments_01',
                cascadeDelete: true,
                maxSelect: 1,
            })
        )
        withParent.indexes = [
            'CREATE INDEX `idx_text_comments_anchor` ON `text_comments` (`drive_item`, `comment_id`)',
            'CREATE INDEX `idx_text_comments_unresolved` ON `text_comments` (`drive_item`, `resolved_at`)',
            'CREATE INDEX `idx_text_comments_author` ON `text_comments` (`author`)',
            'CREATE INDEX `idx_text_comments_parent` ON `text_comments` (`parent_comment`)',
        ]
        app.save(withParent)
    },
    app => {
        const collection = app.findCollectionByNameOrId('text_comments')
        app.delete(collection)
    }
)
