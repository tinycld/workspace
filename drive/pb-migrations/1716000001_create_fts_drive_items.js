/// <reference path="../../../pb_types.d.ts" />
migrate(
    app => {
        app.db()
            .newQuery(
                `CREATE VIRTUAL TABLE IF NOT EXISTS fts_drive_items USING fts5(
                    record_id UNINDEXED,
                    name,
                    description,
                    content,
                    tokenize='porter unicode61'
                )`
            )
            .execute()
    },
    app => {
        app.db().newQuery('DROP TABLE IF EXISTS fts_drive_items').execute()
    }
)
