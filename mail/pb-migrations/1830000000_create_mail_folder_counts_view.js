/// <reference path="../../../server/pb_data/types.d.ts" />

// Aggregates mail_thread_state × mail_threads into per-(user_org, mailbox)
// folder counts. The sidebar reads from this view instead of fetching every
// state row + every thread to count client-side, which scaled poorly for
// users with hundreds of thousands of emails.
//
// Counts mirror computeMailboxFolderCounts in the client:
//   inbox   — thread_state rows with folder='inbox' AND is_read=0
//   drafts  — folder='drafts'
//   sent    — folder='sent'
//   starred — is_starred=1 (any folder)
//   trash   — folder='trash'
//   spam    — folder='spam'
//
// Realtime: PocketBase pushes view-row updates whenever the underlying
// mail_thread_state or mail_threads tables change, so the sidebar updates
// without manual invalidation.
migrate(
    app => {
        const view = new Collection({
            id: 'pbc_mail_folder_counts_01',
            name: 'mail_folder_counts',
            type: 'view',
            system: false,
            // Only the user's own counts are visible.
            listRule: 'user_org.user ?= @request.auth.id',
            viewRule: 'user_org.user ?= @request.auth.id',
            viewQuery: `
                SELECT
                    (s.user_org || ':' || t.mailbox) AS id,
                    s.user_org AS user_org,
                    t.mailbox AS mailbox,
                    SUM(CASE WHEN s.folder = 'inbox' AND s.is_read = 0 THEN 1 ELSE 0 END) AS inbox,
                    SUM(CASE WHEN s.folder = 'drafts' THEN 1 ELSE 0 END) AS drafts,
                    SUM(CASE WHEN s.folder = 'sent' THEN 1 ELSE 0 END) AS sent,
                    SUM(CASE WHEN s.is_starred THEN 1 ELSE 0 END) AS starred,
                    SUM(CASE WHEN s.folder = 'trash' THEN 1 ELSE 0 END) AS trash,
                    SUM(CASE WHEN s.folder = 'spam' THEN 1 ELSE 0 END) AS spam
                FROM mail_thread_state s
                JOIN mail_threads t ON s.thread = t.id
                GROUP BY s.user_org, t.mailbox
            `,
        })
        app.save(view)
    },
    app => {
        const view = app.findCollectionByNameOrId('mail_folder_counts')
        app.delete(view)
    }
)
