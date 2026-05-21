/// <reference path="../../../server/pb_data/types.d.ts" />

// The original createRule on calendar_members (calOwnerRule) traverses a
// back-relation through user_org to check whether the requesting user is
// already an owner of the calendar:
//
//     calendar.calendar_members_via_calendar.user_org.user ?= @request.auth.id
//     && calendar.calendar_members_via_calendar.role ?= "owner"
//
// PB v0.36 evaluates this inconsistently: non-superuser POSTs always 400
// even when the auth user IS an owner. We've moved the owner-check to a Go
// hook (OnRecordCreateRequest in calendar/server/register.go) which is
// reliable, so the rule here just needs to gate to authenticated users.
// The Go hook handles the actual owner-check + last-owner protection.

migrate(
    app => {
        const members = app.findCollectionByNameOrId('calendar_members')
        members.createRule = '@request.auth.id != ""'
        app.save(members)
    },
    app => {
        const members = app.findCollectionByNameOrId('calendar_members')
        members.createRule =
            'calendar.calendar_members_via_calendar.user_org.user ?= @request.auth.id && calendar.calendar_members_via_calendar.role ?= "owner"'
        app.save(members)
    }
)
