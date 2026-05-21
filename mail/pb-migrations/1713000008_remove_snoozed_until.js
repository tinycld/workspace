/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        const threadState = app.findCollectionByNameOrId('mail_thread_state')
        threadState.fields.removeById('mail_thr_state_snoozed_until')
        app.save(threadState)
    },
    app => {
        const threadState = app.findCollectionByNameOrId('mail_thread_state')

        threadState.fields.add(
            new Field({
                id: 'mail_thr_state_snoozed_until',
                name: 'snoozed_until',
                type: 'date',
                required: false,
            })
        )

        app.save(threadState)
    }
)
