/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        const allColors = [
            'blue',
            'green',
            'red',
            'teal',
            'purple',
            'orange',
            'tomato',
            'flamingo',
            'tangerine',
            'banana',
            'sage',
            'basil',
            'peacock',
            'blueberry',
            'lavender',
            'grape',
            'graphite',
        ]

        // Add optional color field to calendar_members
        const members = app.findCollectionByNameOrId('calendar_members')

        members.fields.addAt(
            members.fields.length,
            new Field({
                id: 'cal_members_color',
                name: 'color',
                type: 'select',
                required: false,
                values: allColors,
                maxSelect: 1,
            })
        )

        // Allow members to update their own record (for color changes)
        members.updateRule =
            '(calendar.calendar_members_via_calendar.user_org.user ?= @request.auth.id && calendar.calendar_members_via_calendar.role ?= "owner") || (user_org.user = @request.auth.id)'

        app.save(members)

        // Expand allowed colors on calendar_calendars too
        const calendars = app.findCollectionByNameOrId('calendar_calendars')
        const colorField = calendars.fields.getByName('color')
        colorField.values = allColors
        app.save(calendars)
    },
    app => {
        const members = app.findCollectionByNameOrId('calendar_members')

        members.fields.removeById('cal_members_color')

        // Restore original update rule
        members.updateRule =
            'calendar.calendar_members_via_calendar.user_org.user ?= @request.auth.id && calendar.calendar_members_via_calendar.role ?= "owner"'

        app.save(members)

        // Restore original color values on calendars
        const calendars = app.findCollectionByNameOrId('calendar_calendars')
        const colorField = calendars.fields.getByName('color')
        colorField.values = ['blue', 'green', 'red', 'teal', 'purple', 'orange']
        app.save(calendars)
    }
)
