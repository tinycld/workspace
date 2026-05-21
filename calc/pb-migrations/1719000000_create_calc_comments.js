/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        // Phase 1: create the collection WITHOUT the self-referencing
        // parent_comment field. PB rejects a relation whose
        // collectionId points at a collection that doesn't yet exist —
        // we have to insert the field after the first save. Same
        // two-pass shape drive uses for drive_items.parent.
        const calcComments = new Collection({
            id: 'pbc_calc_comments_01',
            name: 'calc_comments',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'cc_drive_item',
                    name: 'drive_item',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_drive_items_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'cc_sheet_id',
                    name: 'sheet_id',
                    type: 'text',
                    required: true,
                    max: 64,
                },
                {
                    id: 'cc_row',
                    name: 'row',
                    type: 'number',
                    required: true,
                    min: 1,
                },
                {
                    id: 'cc_col',
                    name: 'col',
                    type: 'number',
                    required: true,
                    min: 1,
                },
                {
                    id: 'cc_body',
                    name: 'body',
                    type: 'text',
                    required: true,
                    min: 1,
                    max: 4000,
                },
                {
                    id: 'cc_resolved_at',
                    name: 'resolved_at',
                    type: 'date',
                    required: false,
                },
                {
                    id: 'cc_author',
                    name: 'author',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_user_org_01',
                    cascadeDelete: false,
                    maxSelect: 1,
                },
                {
                    id: 'cc_author_name',
                    name: 'author_name',
                    type: 'text',
                    required: true,
                    max: 200,
                },
                {
                    id: 'cc_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'cc_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            // Mirror drive_items access: anyone with a drive_shares row for the
            // commented-on drive_item can read/write comments. Mutating someone
            // else's comment is forbidden — Sheets parity.
            listRule:
                '@request.auth.id != "" && drive_item.drive_shares_via_item.user_org.user ?= @request.auth.id',
            viewRule:
                '@request.auth.id != "" && drive_item.drive_shares_via_item.user_org.user ?= @request.auth.id',
            createRule:
                '@request.auth.id != "" && drive_item.drive_shares_via_item.user_org.user ?= @request.auth.id && author.user = @request.auth.id',
            updateRule: '@request.auth.id != "" && author.user = @request.auth.id',
            deleteRule: '@request.auth.id != "" && author.user = @request.auth.id',
        })
        app.save(calcComments)

        // Phase 2: add the self-referencing parent_comment field now
        // that the collection exists. Cascade direction: PB cascades
        // on the *target* of the relation, so deleting a root cascades
        // to every reply that points at it (correct — kills the whole
        // thread). Deleting a reply does not cascade to the root.
        const withParent = app.findCollectionByNameOrId('calc_comments')
        withParent.fields.add(
            new Field({
                id: 'cc_parent_comment',
                name: 'parent_comment',
                type: 'relation',
                required: false,
                collectionId: 'pbc_calc_comments_01',
                cascadeDelete: true,
                maxSelect: 1,
            })
        )
        withParent.indexes = [
            'CREATE INDEX `idx_calc_comments_cell` ON `calc_comments` (`drive_item`, `sheet_id`, `row`, `col`)',
            'CREATE INDEX `idx_calc_comments_unresolved` ON `calc_comments` (`drive_item`, `resolved_at`)',
            'CREATE INDEX `idx_calc_comments_author` ON `calc_comments` (`author`)',
            'CREATE INDEX `idx_calc_comments_parent` ON `calc_comments` (`parent_comment`)',
        ]
        app.save(withParent)
    },
    app => {
        const collection = app.findCollectionByNameOrId('calc_comments')
        app.delete(collection)
    }
)
