/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        const threadState = app.findCollectionByNameOrId('mail_thread_state')

        threadState.fields.add(
            new Field({
                id: 'mail_thread_state_is_important',
                name: 'is_important',
                type: 'bool',
                required: false,
            })
        )

        app.save(threadState)
    },
    app => {
        const threadState = app.findCollectionByNameOrId('mail_thread_state')
        threadState.fields.removeById('mail_thread_state_is_important')
        app.save(threadState)
    }
)
