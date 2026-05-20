/// <reference path="../pb_data/types.d.ts" />
// realtime_doc_updates is the write-ahead log for the realtime broker.
// Every accepted MsgDocUpdate is appended here synchronously before
// fan-out, so that a SIGKILL between accept and snapshot does not lose
// the edit. SaveCoordinator truncates rows <= the snapshot's high-water
// seq once a successful docx/xlsx flush has made the snapshot durable.
//
// Schema notes:
//   - room_kind / room_id together identify the room. Matches the
//     roomKey shape in realtime.go.
//   - seq is per-room monotonic, minted under the room's lock at append
//     time. The (room_kind, room_id, seq) unique index catches any race
//     as a hard error rather than silent corruption.
//   - update is base64-encoded Yjs update bytes; capped to ~350 KiB
//     base64-text to allow a 256 KiB binary cap.
//   - The collection is admin-only by design: writes are server-side
//     only, and there is no client read path. The realtime broker
//     reads using app.FindRecordsByFilter, bypassing API rules.
migrate(
    app => {
        const collection = new Collection({
            id: 'pbc_realtime_doc_updates_01',
            name: 'realtime_doc_updates',
            type: 'base',
            system: false,
            listRule: null,
            viewRule: null,
            createRule: null,
            updateRule: null,
            deleteRule: null,
            fields: [
                {
                    id: 'rdu_room_kind',
                    name: 'room_kind',
                    type: 'text',
                    required: true,
                    max: 64,
                },
                {
                    id: 'rdu_room_id',
                    name: 'room_id',
                    type: 'text',
                    required: true,
                    max: 64,
                },
                {
                    id: 'rdu_seq',
                    name: 'seq',
                    type: 'number',
                    required: true,
                    min: 1,
                    onlyInt: true,
                },
                {
                    id: 'rdu_update',
                    name: 'update',
                    type: 'text',
                    required: true,
                    max: 358400,
                },
                {
                    id: 'rdu_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX `idx_realtime_doc_updates_room_seq` ON `realtime_doc_updates` (`room_kind`, `room_id`, `seq`)',
                'CREATE INDEX `idx_realtime_doc_updates_room` ON `realtime_doc_updates` (`room_kind`, `room_id`)',
            ],
        })
        app.save(collection)
    },
    app => {
        try {
            const c = app.findCollectionByNameOrId('realtime_doc_updates')
            app.delete(c)
        } catch (e) {
            // may not exist
        }
    }
)
