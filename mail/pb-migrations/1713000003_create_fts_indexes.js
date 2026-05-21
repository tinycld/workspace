/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        app.db()
            .newQuery(`
            CREATE VIRTUAL TABLE IF NOT EXISTS fts_mail_threads USING fts5(
                record_id UNINDEXED, subject, snippet, participants,
                tokenize='porter unicode61'
            )
        `)
            .execute()

        app.db()
            .newQuery(`
            CREATE VIRTUAL TABLE IF NOT EXISTS fts_mail_messages USING fts5(
                record_id UNINDEXED, subject, snippet, sender_name, sender_email, body_text,
                tokenize='porter unicode61'
            )
        `)
            .execute()
    },
    app => {
        app.db().newQuery('DROP TABLE IF EXISTS fts_mail_messages').execute()
        app.db().newQuery('DROP TABLE IF EXISTS fts_mail_threads').execute()
    }
)
