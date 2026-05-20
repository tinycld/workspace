/// <reference path="../pb_data/types.d.ts" />
// Add a free-form JSON metadata column to users for low-stakes per-user flags
// that aren't worth a dedicated schema field — currently isBetaTester (read by
// useAppUpdates to route OTA fetches to the preview channel) and any future
// keys we want to set by hand against a single user.
migrate(
    app => {
        const users = app.findCollectionByNameOrId('users')
        users.fields.addAt(
            users.fields.length,
            new Field({
                id: 'users_metadata',
                name: 'metadata',
                type: 'json',
            })
        )
        app.save(users)
    },
    app => {
        const users = app.findCollectionByNameOrId('users')
        users.fields.removeById('users_metadata')
        app.save(users)
    }
)
