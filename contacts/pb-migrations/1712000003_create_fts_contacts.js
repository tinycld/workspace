/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        app.db()
            .newQuery(`
            CREATE VIRTUAL TABLE IF NOT EXISTS fts_contacts USING fts5(
                record_id UNINDEXED, first_name, last_name, email, company, phone, notes,
                tokenize='porter unicode61'
            )
        `)
            .execute()
    },
    app => {
        app.db().newQuery('DROP TABLE IF EXISTS fts_contacts').execute()
    }
)
