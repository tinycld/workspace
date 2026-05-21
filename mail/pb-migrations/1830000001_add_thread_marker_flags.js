/// <reference path="../../../server/pb_data/types.d.ts" />

// Denormalize "any draft message?" / "any message with attachments?" onto
// mail_threads as boolean flags. The thread list reads these directly off
// the page rows, replacing two extra mail_messages queries per page render
// (one for drafts, one for attachment markers).
//
// Maintenance: a Go hook on mail_messages create/update/delete recomputes
// the affected thread's flags. See server/register.go.
migrate(
    app => {
        const threads = app.findCollectionByNameOrId('mail_threads')

        threads.fields.add(
            new Field({
                id: 'mail_threads_has_draft',
                name: 'has_draft',
                type: 'bool',
            })
        )
        threads.fields.add(
            new Field({
                id: 'mail_threads_has_attachments',
                name: 'has_attachments',
                type: 'bool',
            })
        )

        app.save(threads)

        // Backfill from existing data so the flags are accurate before the
        // server hook starts maintaining them.
        app.db().newQuery(`
            UPDATE mail_threads
            SET has_draft = EXISTS(
                SELECT 1 FROM mail_messages
                WHERE mail_messages.thread = mail_threads.id
                  AND mail_messages.delivery_status = 'draft'
            )
        `).execute()
        app.db().newQuery(`
            UPDATE mail_threads
            SET has_attachments = EXISTS(
                SELECT 1 FROM mail_messages
                WHERE mail_messages.thread = mail_threads.id
                  AND mail_messages.has_attachments = 1
            )
        `).execute()
    },
    app => {
        const threads = app.findCollectionByNameOrId('mail_threads')
        threads.fields.removeById('mail_threads_has_attachments')
        threads.fields.removeById('mail_threads_has_draft')
        app.save(threads)
    }
)
