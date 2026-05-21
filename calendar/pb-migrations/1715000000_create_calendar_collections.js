/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        // Phase 1: Create all collections without access rules (avoids back-relation ordering issues)

        // 1. calendar_calendars
        const calendars = new Collection({
            id: 'pbc_cal_calendars_01',
            name: 'calendar_calendars',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'cal_calendars_org',
                    name: 'org',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_orgs_00001',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'cal_calendars_name',
                    name: 'name',
                    type: 'text',
                    required: true,
                    min: 1,
                    max: 200,
                },
                {
                    id: 'cal_calendars_description',
                    name: 'description',
                    type: 'text',
                    required: false,
                    max: 500,
                },
                {
                    id: 'cal_calendars_color',
                    name: 'color',
                    type: 'select',
                    required: true,
                    values: ['blue', 'green', 'red', 'teal', 'purple', 'orange'],
                    maxSelect: 1,
                },
                {
                    id: 'cal_calendars_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'cal_calendars_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: ['CREATE INDEX `idx_cal_calendars_org` ON `calendar_calendars` (`org`)'],
        })
        app.save(calendars)

        // 2. calendar_members
        const members = new Collection({
            id: 'pbc_cal_members_01',
            name: 'calendar_members',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'cal_members_calendar',
                    name: 'calendar',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_cal_calendars_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'cal_members_user_org',
                    name: 'user_org',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_user_org_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'cal_members_role',
                    name: 'role',
                    type: 'select',
                    required: true,
                    values: ['owner', 'editor', 'viewer'],
                    maxSelect: 1,
                },
                {
                    id: 'cal_members_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'cal_members_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX `idx_cal_members_unique` ON `calendar_members` (`calendar`, `user_org`)',
                'CREATE INDEX `idx_cal_members_calendar` ON `calendar_members` (`calendar`)',
                'CREATE INDEX `idx_cal_members_user_org` ON `calendar_members` (`user_org`)',
            ],
        })
        app.save(members)

        // 3. calendar_events
        const events = new Collection({
            id: 'pbc_cal_events_01',
            name: 'calendar_events',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'cal_events_calendar',
                    name: 'calendar',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_cal_calendars_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'cal_events_created_by',
                    name: 'created_by',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_user_org_01',
                    cascadeDelete: false,
                    maxSelect: 1,
                },
                {
                    id: 'cal_events_title',
                    name: 'title',
                    type: 'text',
                    required: true,
                    min: 1,
                    max: 500,
                },
                {
                    id: 'cal_events_description',
                    name: 'description',
                    type: 'text',
                    required: false,
                    max: 5000,
                },
                {
                    id: 'cal_events_location',
                    name: 'location',
                    type: 'text',
                    required: false,
                    max: 500,
                },
                {
                    id: 'cal_events_start',
                    name: 'start',
                    type: 'date',
                    required: true,
                },
                {
                    id: 'cal_events_end',
                    name: 'end',
                    type: 'date',
                    required: true,
                },
                {
                    id: 'cal_events_all_day',
                    name: 'all_day',
                    type: 'bool',
                },
                {
                    id: 'cal_events_recurrence',
                    name: 'recurrence',
                    type: 'text',
                    required: false,
                    max: 500,
                },
                {
                    id: 'cal_events_guests',
                    name: 'guests',
                    type: 'json',
                    required: false,
                },
                {
                    id: 'cal_events_reminder',
                    name: 'reminder',
                    type: 'number',
                    required: false,
                    min: 0,
                },
                {
                    id: 'cal_events_busy_status',
                    name: 'busy_status',
                    type: 'select',
                    required: true,
                    values: ['busy', 'free'],
                    maxSelect: 1,
                },
                {
                    id: 'cal_events_visibility',
                    name: 'visibility',
                    type: 'select',
                    required: true,
                    values: ['default', 'public', 'private'],
                    maxSelect: 1,
                },
                {
                    id: 'cal_events_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'cal_events_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE INDEX `idx_cal_events_calendar_start` ON `calendar_events` (`calendar`, `start`)',
                'CREATE INDEX `idx_cal_events_calendar` ON `calendar_events` (`calendar`)',
            ],
        })
        app.save(events)

        // Phase 2: Apply access rules now that all collections exist and back-relations resolve
        const calMemberRule = 'calendar_members_via_calendar.user_org.user ?= @request.auth.id'
        const calOwnerRule =
            'calendar_members_via_calendar.user_org.user ?= @request.auth.id && calendar_members_via_calendar.role ?= "owner"'
        const orgMemberRule = 'org.user_org_via_org.user ?= @request.auth.id'
        const calMemberViaCalendarRule =
            'calendar.calendar_members_via_calendar.user_org.user ?= @request.auth.id'
        const calEditorViaCalendarRule =
            'calendar.calendar_members_via_calendar.user_org.user ?= @request.auth.id && calendar.calendar_members_via_calendar.role ?!= "viewer"'
        const userOrgRule = 'user_org.user = @request.auth.id'

        function setRules(collection, { list, view, create, update, del }) {
            collection.listRule = list
            collection.viewRule = view
            collection.createRule = create
            collection.updateRule = update
            collection.deleteRule = del
        }

        // calendar_calendars: viewable by members, creatable by any org member, editable/deletable by owners
        const calendarsCol = app.findCollectionByNameOrId('calendar_calendars')
        setRules(calendarsCol, {
            list: calMemberRule,
            view: calMemberRule,
            create: orgMemberRule,
            update: calOwnerRule,
            del: calOwnerRule,
        })
        app.save(calendarsCol)

        // calendar_members: viewable by the member themselves, manageable by calendar owners
        const membersCol = app.findCollectionByNameOrId('calendar_members')
        setRules(membersCol, {
            list: userOrgRule,
            view: userOrgRule,
            create: 'user_org.user = @request.auth.id && calendar.calendar_members_via_calendar.user_org.user ?= @request.auth.id && calendar.calendar_members_via_calendar.role ?= "owner"',
            update: 'calendar.calendar_members_via_calendar.user_org.user ?= @request.auth.id && calendar.calendar_members_via_calendar.role ?= "owner"',
            del: userOrgRule,
        })
        app.save(membersCol)

        // calendar_events: viewable by any calendar member, creatable/editable/deletable by owners and editors
        const eventsCol = app.findCollectionByNameOrId('calendar_events')
        setRules(eventsCol, {
            list: calMemberViaCalendarRule,
            view: calMemberViaCalendarRule,
            create: calEditorViaCalendarRule,
            update: calEditorViaCalendarRule,
            del: calEditorViaCalendarRule,
        })
        app.save(eventsCol)
    },
    app => {
        const collections = ['calendar_events', 'calendar_members', 'calendar_calendars']
        for (const name of collections) {
            const collection = app.findCollectionByNameOrId(name)
            app.delete(collection)
        }
    }
)
