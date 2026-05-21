# Folder counts realtime — design notes

The sidebar's per-folder unread counts come from the `mail_folder_counts` view
collection (see `pb-migrations/1830000000_create_mail_folder_counts_view.js`).
Views aggregate `mail_thread_state × mail_threads` server-side, which is fast,
but PocketBase **does not emit realtime events for view collections** — nothing
writes to a view, so the auto-broadcast hooks
(`apis/realtime.go::bindRealtimeEvents`) never fire for it.

## Current solution (shipped)

`tinycld/mail/hooks/useMailboxFolderCounts.ts` subscribes to local
`mail_thread_state` changes via TanStack DB's `subscribeChanges` and
invalidates the `mail_folder_counts` query on each batch. Combined with a
nav-triggered invalidation in `screens/index.tsx` and the existing
pull-to-refresh / toolbar refresh paths, the sidebar stays in sync for the
acting client.

Trade-off: cross-device staleness. If you mark a thread read on your phone,
your desktop sidebar won't update until the desktop performs *some* action
that triggers a refetch (nav, refresh, pull-to-refresh).

## Alternative considered: server-side broadcast from a Go hook

PocketBase's `realtimeBroadcastRecord` (`apis/realtime.go:487`) is unexported,
but every primitive it relies on **is** public:

- `app.SubscriptionsBroker().ChunkedClients(n)` → `[]Client`
- `client.Subscriptions(prefix)`, `client.Get(apis.RealtimeClientAuthKey)`,
  `client.Send(subscriptions.Message{...})`
- `app.CanAccessRecord(record, requestInfo, rule)`
- `app.FindRecordById("mail_folder_counts", id)` works for view rows

So we can reimplement broadcast in a Go hook and fire it from
`OnRecordAfter{Create,Update,Delete}Success("mail_thread_state")` (and any
other table whose change can shift a count, e.g. `mail_threads` mailbox
moves).

Sketch:

```go
func broadcastFolderCounts(e *core.RecordEvent) error {
    userOrgId := e.Record.GetString("user_org")
    threadId  := e.Record.GetString("thread")
    thread, err := e.App.FindRecordById("mail_threads", threadId)
    if err != nil { return e.Next() }
    viewId := userOrgId + ":" + thread.GetString("mailbox")
    viewRec, err := e.App.FindRecordById("mail_folder_counts", viewId)
    if err != nil { return e.Next() }
    broadcastRecord(e.App, "update", viewRec)
    return e.Next()
}

func broadcastRecord(app core.App, action string, record *core.Record) {
    collection := record.Collection()
    rules := map[string]*string{
        collection.Name + "/*?":                  collection.ListRule,
        collection.Name + "/" + record.Id + "?":  collection.ViewRule,
    }
    for _, chunk := range app.SubscriptionsBroker().ChunkedClients(100) {
        for _, client := range chunk {
            for prefix, rule := range rules {
                subs := client.Subscriptions(prefix)
                if len(subs) == 0 { continue }
                authRec, _ := client.Get(apis.RealtimeClientAuthKey).(*core.Record)
                for sub, opts := range subs {
                    info := &core.RequestInfo{
                        Context: core.RequestInfoContextRealtime,
                        Method:  "GET",
                        Query:   opts.Query,
                        Headers: opts.Headers,
                        Auth:    authRec,
                    }
                    ok, _ := app.CanAccessRecord(record, info, rule)
                    if !ok { continue }
                    payload, _ := json.Marshal(map[string]any{
                        "action": action,
                        "record": record.Fresh(),
                    })
                    client.Send(subscriptions.Message{Name: sub, Data: payload})
                }
            }
        }
    }
}
```

### Why we did not ship this

1. **Pinned to internal payload shape.** The exported APIs are stable, but
   the broadcast envelope (`{action, record}`) is whatever PocketBase happens
   to emit. A future PB version could add fields and our payload would
   diverge silently.
2. **Read amplification.** Every `mail_thread_state` write triggers a
   `FindRecordById("mail_folder_counts", ...)` — a per-row aggregation by
   SQLite. Bulk ops (e.g. "mark 200 emails read") fire 200 times. Solvable
   with a per-transaction debounce keyed on `(user_org, mailbox)`, but that
   doubles the code.
3. **Delete-to-zero is awkward.** When the last thread in a mailbox is
   removed, the view row disappears. Broadcasting requires a synthetic
   zero-row or a delete event — more edge cases.
4. **~50 lines of Go + tests + transaction reasoning** vs. ~10 lines of
   client TS. The client bridge already covers the acting-client case, which
   is the only one users routinely notice.

### When to revisit

- Multiple real complaints about cross-device staleness in the sidebar.
- A second view collection appears with the same problem (mail likely won't
  be the only place we want server-side aggregates) — at that point a
  generic `broadcastViewRow(app, viewName, id)` helper amortizes the cost.

### References

- `apis/realtime.go:270-394` — auto-broadcast hooks (model events).
- `apis/realtime.go:487-630` — `realtimeBroadcastRecord` body to mirror.
- `core/record_model.go:423-425` — view records can't be deleted (so don't
  try to mutate the view, only fetch + broadcast).
- `tools/subscriptions/{broker.go,client.go}` — public broker/client API.
