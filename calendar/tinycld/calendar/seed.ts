import type PocketBase from 'pocketbase'

function log(...args: unknown[]) {
    process.stdout.write(`[seed:calendar] ${args.join(' ')}\n`)
}

interface SeedContext {
    user: { id: string; email: string; name: string }
    org: { id: string }
    userOrg: { id: string }
}

function today() {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
}

function dateAt(dayOffset: number, hour: number, minute = 0) {
    const d = today()
    d.setDate(d.getDate() + dayOffset)
    d.setHours(hour, minute, 0, 0)
    return d.toISOString()
}

function allDayDate(dayOffset: number) {
    const d = today()
    d.setDate(d.getDate() + dayOffset)
    return d.toISOString()
}

const CALENDARS = [
    { name: 'Work', color: 'blue', description: 'Work calendar' },
    { name: 'Personal', color: 'green', description: 'Personal events' },
    { name: 'Team', color: 'teal', description: 'Shared team calendar' },
    { name: 'Holidays', color: 'red', description: 'Company holidays' },
] as const

const EVENTS = [
    // =========================================================================
    // DAY -7: Sparse day — single long event (baseline)
    // =========================================================================
    {
        title: 'Quarterly Planning',
        description: 'Full-day planning session',
        location: 'Board Room',
        start: () => dateAt(-7, 9, 0),
        end: () => dateAt(-7, 17, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [{ name: 'Alice Chen', email: 'alice@acme.co', rsvp: 'accepted', role: 'organizer' }],
        reminder: 30,
        busy_status: 'busy',
        visibility: 'default',
    },

    // =========================================================================
    // DAY -6: Cascading overlaps — A overlaps B, B overlaps C, but not A & C
    // Tests whether the layout merges them into one cluster or splits them
    // =========================================================================
    {
        title: 'Kickoff Meeting',
        description: '',
        location: 'Room 101',
        start: () => dateAt(-6, 9, 0),
        end: () => dateAt(-6, 10, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Architecture Review',
        description: 'Overlaps both kickoff tail and design start',
        location: 'Room 101',
        start: () => dateAt(-6, 9, 30),
        end: () => dateAt(-6, 11, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Design Sync',
        description: 'Starts after Kickoff ends, but overlaps Architecture',
        location: 'Zoom',
        start: () => dateAt(-6, 10, 30),
        end: () => dateAt(-6, 12, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Lunch Run',
        description: 'Isolated — no overlap',
        location: '',
        start: () => dateAt(-6, 12, 30),
        end: () => dateAt(-6, 13, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Personal',
        guests: [],
        reminder: 0,
        busy_status: 'free',
        visibility: 'default',
    },

    // =========================================================================
    // DAY -5: Tiny event inside a large block
    // A 4-hour block with a 15-min event in the middle — tests how the layout
    // handles wildly different durations sharing the same column space
    // =========================================================================
    {
        title: 'Deep Work Block',
        description: 'Long focus session',
        location: '',
        start: () => dateAt(-5, 9, 0),
        end: () => dateAt(-5, 13, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Personal',
        guests: [],
        reminder: 0,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Quick Standup',
        description: 'Tiny event overlapping the deep work block',
        location: 'Slack huddle',
        start: () => dateAt(-5, 10, 0),
        end: () => dateAt(-5, 10, 15),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [{ name: 'Bob Smith', email: 'bob@acme.co', rsvp: 'accepted', role: 'attendee' }],
        reminder: 5,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Fire Drill',
        description: 'Another tiny event inside the block',
        location: '',
        start: () => dateAt(-5, 11, 45),
        end: () => dateAt(-5, 12, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 0,
        busy_status: 'busy',
        visibility: 'default',
    },

    // =========================================================================
    // DAY -4: Back-to-back events with zero gap
    // Tests the <= vs < boundary in overlap detection
    // =========================================================================
    {
        title: 'Interview: Round 1',
        description: '',
        location: 'Room A',
        start: () => dateAt(-4, 10, 0),
        end: () => dateAt(-4, 11, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [{ name: 'Carol Wu', email: 'carol@acme.co', rsvp: 'accepted', role: 'attendee' }],
        reminder: 15,
        busy_status: 'busy',
        visibility: 'private',
    },
    {
        title: 'Interview: Round 2',
        description: '',
        location: 'Room A',
        start: () => dateAt(-4, 11, 0),
        end: () => dateAt(-4, 12, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [{ name: 'Dave Johnson', email: 'dave@acme.co', rsvp: 'accepted', role: 'attendee' }],
        reminder: 15,
        busy_status: 'busy',
        visibility: 'private',
    },
    {
        title: 'Interview: Round 3',
        description: '',
        location: 'Room A',
        start: () => dateAt(-4, 12, 0),
        end: () => dateAt(-4, 13, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 15,
        busy_status: 'busy',
        visibility: 'private',
    },
    {
        title: 'Debrief',
        description: 'Starts exactly when Round 3 ends',
        location: 'Room A',
        start: () => dateAt(-4, 13, 0),
        end: () => dateAt(-4, 13, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 0,
        busy_status: 'busy',
        visibility: 'private',
    },

    // =========================================================================
    // DAY -3: Six-way overlap — maximum column pressure
    // All events overlap at 14:00–14:30 but have staggered starts/ends
    // =========================================================================
    {
        title: 'Exec Sync',
        description: '',
        location: 'Board Room',
        start: () => dateAt(-3, 13, 0),
        end: () => dateAt(-3, 15, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [{ name: 'Alice Chen', email: 'alice@acme.co', rsvp: 'accepted', role: 'organizer' }],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Bug Triage',
        description: '',
        location: '',
        start: () => dateAt(-3, 13, 30),
        end: () => dateAt(-3, 14, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 5,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Vendor Call',
        description: '',
        location: 'Zoom',
        start: () => dateAt(-3, 14, 0),
        end: () => dateAt(-3, 15, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Coffee Chat',
        description: '',
        location: 'Lobby',
        start: () => dateAt(-3, 14, 0),
        end: () => dateAt(-3, 14, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Personal',
        guests: [],
        reminder: 0,
        busy_status: 'free',
        visibility: 'default',
    },
    {
        title: '1:1 with PM',
        description: '',
        location: 'Office',
        start: () => dateAt(-3, 14, 15),
        end: () => dateAt(-3, 15, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'private',
    },
    {
        title: 'Sprint Retro',
        description: '',
        location: 'Room B',
        start: () => dateAt(-3, 14, 30),
        end: () => dateAt(-3, 16, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [
            { name: 'Bob Smith', email: 'bob@acme.co', rsvp: 'accepted', role: 'attendee' },
            { name: 'Carol Wu', email: 'carol@acme.co', rsvp: 'tentative', role: 'attendee' },
        ],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'default',
    },

    // =========================================================================
    // DAY -2: Events that barely overlap (1-minute overlap)
    // Stresses overlap boundary — should they share columns or not?
    // =========================================================================
    {
        title: 'Morning Standup',
        description: '',
        location: 'Slack',
        start: () => dateAt(-2, 9, 0),
        end: () => dateAt(-2, 9, 31),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 5,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Code Review',
        description: 'Overlaps standup by just 1 minute',
        location: '',
        start: () => dateAt(-2, 9, 30),
        end: () => dateAt(-2, 10, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 5,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Design Workshop',
        description: 'Overlaps code review by 1 minute',
        location: 'Room C',
        start: () => dateAt(-2, 10, 29),
        end: () => dateAt(-2, 11, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'default',
    },

    // =========================================================================
    // DAY -1: Mixed durations — tall skinny vs short wide
    // Two parallel tracks with different event sizes
    // =========================================================================
    {
        title: 'Strategy Session',
        description: 'Tall event — 3 hours',
        location: 'Board Room',
        start: () => dateAt(-1, 9, 0),
        end: () => dateAt(-1, 12, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [
            { name: 'Alice Chen', email: 'alice@acme.co', rsvp: 'accepted', role: 'organizer' },
            { name: 'Dave Johnson', email: 'dave@acme.co', rsvp: 'pending', role: 'attendee' },
        ],
        reminder: 30,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Slack Check',
        description: '15 min — overlaps strategy start',
        location: '',
        start: () => dateAt(-1, 9, 0),
        end: () => dateAt(-1, 9, 15),
        all_day: false,
        recurrence: '',
        calendar: 'Personal',
        guests: [],
        reminder: 0,
        busy_status: 'free',
        visibility: 'default',
    },
    {
        title: 'Email Triage',
        description: '30 min — fits after Slack Check in same column',
        location: '',
        start: () => dateAt(-1, 9, 15),
        end: () => dateAt(-1, 9, 45),
        all_day: false,
        recurrence: '',
        calendar: 'Personal',
        guests: [],
        reminder: 0,
        busy_status: 'free',
        visibility: 'default',
    },
    {
        title: 'Platform Outage Call',
        description: 'Overlaps tail of strategy session',
        location: 'Zoom',
        start: () => dateAt(-1, 11, 0),
        end: () => dateAt(-1, 12, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 0,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Client Lunch',
        description: '',
        location: 'Cafe Milano',
        start: () => dateAt(-1, 12, 30),
        end: () => dateAt(-1, 14, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [{ name: 'Bob Smith', email: 'bob@acme.co', rsvp: 'accepted', role: 'organizer' }],
        reminder: 30,
        busy_status: 'busy',
        visibility: 'default',
    },

    // =========================================================================
    // DAY 0 (TODAY): Heavily packed — the "worst case Wednesday"
    // Morning: 4 overlapping events, afternoon: 3 overlapping + a long block
    // =========================================================================
    {
        title: 'Team Standup',
        description: 'Daily sync',
        location: 'Room A',
        start: () => dateAt(0, 9, 0),
        end: () => dateAt(0, 9, 30),
        all_day: false,
        recurrence: 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR',
        calendar: 'Work',
        guests: [
            { name: 'Alice Chen', email: 'alice@acme.co', rsvp: 'accepted', role: 'organizer' },
            { name: 'Bob Smith', email: 'bob@acme.co', rsvp: 'accepted', role: 'attendee' },
            { name: 'Carol Wu', email: 'carol@acme.co', rsvp: 'tentative', role: 'attendee' },
        ],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Onboarding: New Hire',
        description: 'Same time as standup — forces 2 columns',
        location: 'Room B',
        start: () => dateAt(0, 9, 0),
        end: () => dateAt(0, 10, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Sprint Planning',
        description: 'Overlaps standup end and onboarding',
        location: '',
        start: () => dateAt(0, 9, 15),
        end: () => dateAt(0, 10, 45),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Investor Update',
        description: 'Overlaps sprint planning — 4th column needed briefly',
        location: 'Zoom',
        start: () => dateAt(0, 9, 30),
        end: () => dateAt(0, 10, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 15,
        busy_status: 'busy',
        visibility: 'private',
    },
    {
        title: 'Design Review',
        description: '',
        location: 'Figma',
        start: () => dateAt(0, 11, 0),
        end: () => dateAt(0, 12, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [{ name: 'Dave Johnson', email: 'dave@acme.co', rsvp: 'pending', role: 'attendee' }],
        reminder: 15,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Lunch & Learn',
        description: '',
        location: 'Kitchen',
        start: () => dateAt(0, 12, 0),
        end: () => dateAt(0, 13, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 10,
        busy_status: 'free',
        visibility: 'default',
    },
    {
        title: 'Focus Time',
        description: 'Long afternoon block — gets split by overlapping meetings',
        location: '',
        start: () => dateAt(0, 13, 0),
        end: () => dateAt(0, 17, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Personal',
        guests: [],
        reminder: 0,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Product Review',
        description: 'Overlaps focus time',
        location: 'Room C',
        start: () => dateAt(0, 14, 0),
        end: () => dateAt(0, 15, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [{ name: 'Alice Chen', email: 'alice@acme.co', rsvp: 'accepted', role: 'organizer' }],
        reminder: 15,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Incident Postmortem',
        description: 'Also overlaps focus time — 3 columns needed',
        location: 'Room D',
        start: () => dateAt(0, 14, 30),
        end: () => dateAt(0, 15, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [{ name: 'Carol Wu', email: 'carol@acme.co', rsvp: 'accepted', role: 'attendee' }],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'default',
    },

    // =========================================================================
    // DAY +1: Early-morning and late-evening bookends
    // Tests rendering at grid extremes (7am, 10pm)
    // =========================================================================
    {
        title: 'Gym',
        description: '',
        location: 'Fitness Center',
        start: () => dateAt(1, 6, 30),
        end: () => dateAt(1, 7, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Personal',
        guests: [],
        reminder: 15,
        busy_status: 'free',
        visibility: 'private',
    },
    {
        title: '1:1 with Manager',
        description: '',
        location: 'Office',
        start: () => dateAt(1, 10, 0),
        end: () => dateAt(1, 10, 45),
        all_day: false,
        recurrence: 'FREQ=WEEKLY',
        calendar: 'Work',
        guests: [],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'private',
    },
    {
        title: 'Board Game Night',
        description: '',
        location: "Bob's place",
        start: () => dateAt(1, 20, 0),
        end: () => dateAt(1, 22, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Personal',
        guests: [
            { name: 'Bob Smith', email: 'bob@acme.co', rsvp: 'accepted', role: 'organizer' },
            { name: 'Eve Miller', email: 'eve@acme.co', rsvp: 'accepted', role: 'attendee' },
        ],
        reminder: 60,
        busy_status: 'free',
        visibility: 'default',
    },

    // =========================================================================
    // DAY +2: Identical start times — 3 events starting at exactly 14:00
    // Tests deterministic ordering when start times are equal
    // =========================================================================
    {
        title: 'Product Demo',
        description: '2 hours',
        location: 'Main Room',
        start: () => dateAt(2, 14, 0),
        end: () => dateAt(2, 16, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [
            { name: 'Alice Chen', email: 'alice@acme.co', rsvp: 'accepted', role: 'organizer' },
            { name: 'Dave Johnson', email: 'dave@acme.co', rsvp: 'pending', role: 'attendee' },
        ],
        reminder: 30,
        busy_status: 'busy',
        visibility: 'public',
    },
    {
        title: 'Parallel Workshop A',
        description: '1 hour — same start as demo',
        location: 'Room 201',
        start: () => dateAt(2, 14, 0),
        end: () => dateAt(2, 15, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Parallel Workshop B',
        description: '1 hour — same start as demo',
        location: 'Room 202',
        start: () => dateAt(2, 14, 0),
        end: () => dateAt(2, 15, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'default',
    },

    // =========================================================================
    // DAY +3: Single events, no overlap — palette cleanser
    // =========================================================================
    {
        title: 'Dentist',
        description: '',
        location: 'Dr. Smith Office',
        start: () => dateAt(3, 10, 0),
        end: () => dateAt(3, 11, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Personal',
        guests: [],
        reminder: 120,
        busy_status: 'busy',
        visibility: 'private',
    },
    {
        title: 'Yoga Class',
        description: '',
        location: 'Downtown Studio',
        start: () => dateAt(3, 18, 0),
        end: () => dateAt(3, 19, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Personal',
        guests: [],
        reminder: 60,
        busy_status: 'free',
        visibility: 'default',
    },

    // =========================================================================
    // DAY +4: "Staircase" pattern — each event starts 30 min after the last
    // but overlaps the previous by 30 min, creating a diagonal
    // =========================================================================
    {
        title: 'Sync: Frontend',
        description: '',
        location: '',
        start: () => dateAt(4, 9, 0),
        end: () => dateAt(4, 10, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 5,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Sync: Backend',
        description: '',
        location: '',
        start: () => dateAt(4, 9, 30),
        end: () => dateAt(4, 10, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 5,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Sync: Infra',
        description: '',
        location: '',
        start: () => dateAt(4, 10, 0),
        end: () => dateAt(4, 11, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 5,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Sync: Data',
        description: '',
        location: '',
        start: () => dateAt(4, 10, 30),
        end: () => dateAt(4, 11, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 5,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Sync: Mobile',
        description: '',
        location: '',
        start: () => dateAt(4, 11, 0),
        end: () => dateAt(4, 12, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 5,
        busy_status: 'busy',
        visibility: 'default',
    },

    // =========================================================================
    // DAY +5: Nested containment — short events fully contained in longer ones
    // Tests width expansion (effectiveSpan) in the layout algorithm
    // =========================================================================
    {
        title: 'All-Hands',
        description: '3-hour umbrella event',
        location: 'Auditorium',
        start: () => dateAt(5, 10, 0),
        end: () => dateAt(5, 13, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [{ name: 'Alice Chen', email: 'alice@acme.co', rsvp: 'accepted', role: 'organizer' }],
        reminder: 30,
        busy_status: 'busy',
        visibility: 'public',
    },
    {
        title: 'Lightning Talk 1',
        description: 'Contained within All-Hands',
        location: 'Auditorium',
        start: () => dateAt(5, 10, 30),
        end: () => dateAt(5, 10, 45),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 5,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Lightning Talk 2',
        description: 'Also contained, overlaps LT1 end',
        location: 'Auditorium',
        start: () => dateAt(5, 10, 40),
        end: () => dateAt(5, 11, 0),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 5,
        busy_status: 'busy',
        visibility: 'default',
    },
    {
        title: 'Breakout Session',
        description: 'Contained, later in the block',
        location: 'Room E',
        start: () => dateAt(5, 11, 30),
        end: () => dateAt(5, 12, 30),
        all_day: false,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 10,
        busy_status: 'busy',
        visibility: 'default',
    },

    // =========================================================================
    // DAY +6: Empty day — no timed events, only an all-day event
    // =========================================================================

    // =========================================================================
    // DAY +7: Late night event near midnight
    // Tests edge rendering at bottom of the time grid
    // =========================================================================
    {
        title: 'Deploy Window',
        description: 'Late-night maintenance window',
        location: '',
        start: () => dateAt(7, 23, 0),
        end: () => dateAt(7, 23, 59),
        all_day: false,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 60,
        busy_status: 'busy',
        visibility: 'default',
    },

    // =========================================================================
    // ALL-DAY EVENTS: Overlapping multi-day spans for row-packing stress
    // These create interesting patterns in week view and month view
    // =========================================================================

    // Full-week span: forces all other all-day events into row 1+
    {
        title: 'Sprint 42',
        description: 'Full sprint marker',
        location: '',
        start: () => allDayDate(-7),
        end: () => allDayDate(-1),
        all_day: true,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 0,
        busy_status: 'free',
        visibility: 'default',
    },

    // Overlaps Sprint 42 partially
    {
        title: 'Alice OOO',
        description: 'Vacation',
        location: '',
        start: () => allDayDate(-5),
        end: () => allDayDate(-2),
        all_day: true,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 0,
        busy_status: 'free',
        visibility: 'default',
    },

    // Short single-day all-day, overlaps both Sprint 42 and Alice OOO
    {
        title: 'Release Day',
        description: '',
        location: '',
        start: () => allDayDate(-3),
        end: () => allDayDate(-3),
        all_day: true,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 0,
        busy_status: 'busy',
        visibility: 'public',
    },

    // Spans from last week into this week — tests cross-week clipping
    {
        title: 'Contractor Visit',
        description: 'Spans across the week boundary',
        location: '',
        start: () => allDayDate(-2),
        end: () => allDayDate(1),
        all_day: true,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 0,
        busy_status: 'busy',
        visibility: 'default',
    },

    // Today only
    {
        title: 'Matt OOO',
        description: 'Out of office',
        location: '',
        start: () => allDayDate(0),
        end: () => allDayDate(0),
        all_day: true,
        recurrence: '',
        calendar: 'Team',
        guests: [],
        reminder: 0,
        busy_status: 'free',
        visibility: 'default',
    },

    // Overlaps Contractor Visit and extends further
    {
        title: 'Feature Freeze',
        description: '',
        location: '',
        start: () => allDayDate(0),
        end: () => allDayDate(4),
        all_day: true,
        recurrence: '',
        calendar: 'Work',
        guests: [],
        reminder: 0,
        busy_status: 'busy',
        visibility: 'public',
    },

    // Future week
    {
        title: 'Company Holiday',
        description: 'Office closed',
        location: '',
        start: () => allDayDate(6),
        end: () => allDayDate(6),
        all_day: true,
        recurrence: '',
        calendar: 'Holidays',
        guests: [],
        reminder: 0,
        busy_status: 'free',
        visibility: 'public',
    },

    // Multi-day that overlaps holiday
    {
        title: 'Team Offsite',
        description: '',
        location: 'Mountain Lodge',
        start: () => allDayDate(5),
        end: () => allDayDate(7),
        all_day: true,
        recurrence: '',
        calendar: 'Team',
        guests: [
            { name: 'Alice Chen', email: 'alice@acme.co', rsvp: 'accepted', role: 'organizer' },
            { name: 'Bob Smith', email: 'bob@acme.co', rsvp: 'accepted', role: 'attendee' },
            { name: 'Carol Wu', email: 'carol@acme.co', rsvp: 'tentative', role: 'attendee' },
        ],
        reminder: 1440,
        busy_status: 'busy',
        visibility: 'default',
    },
]

function roleForCalendar(calName: string) {
    if (calName === 'Work' || calName === 'Personal') return 'owner'
    if (calName === 'Team') return 'editor'
    return 'viewer'
}

async function seedCalendars(pb: PocketBase, orgId: string, userOrgId: string, otherMembers: { id: string }[]) {
    const calendarMap: Record<string, string> = {}
    for (const cal of CALENDARS) {
        log(`Creating calendar: ${cal.name}`)
        const record = await pb.collection('calendar_calendars').create({
            org: orgId,
            name: cal.name,
            description: cal.description,
            color: cal.color,
        })
        calendarMap[cal.name] = record.id

        await pb.collection('calendar_members').create({
            calendar: record.id,
            user_org: userOrgId,
            role: roleForCalendar(cal.name),
        })

        if (cal.name === 'Team' || cal.name === 'Holidays') {
            for (const member of otherMembers) {
                await pb.collection('calendar_members').create({
                    calendar: record.id,
                    user_org: member.id,
                    role: cal.name === 'Team' ? 'editor' : 'viewer',
                })
            }
        }
    }
    return calendarMap
}

async function seedEvents(pb: PocketBase, calendarMap: Record<string, string>, userOrgId: string) {
    for (const event of EVENTS) {
        await pb.collection('calendar_events').create({
            calendar: calendarMap[event.calendar],
            created_by: userOrgId,
            title: event.title,
            description: event.description,
            location: event.location,
            start: event.start(),
            end: event.end(),
            all_day: event.all_day,
            recurrence: event.recurrence,
            guests: event.guests,
            reminder: event.reminder,
            busy_status: event.busy_status,
            visibility: event.visibility,
        })
    }
}

export default async function seed(pb: PocketBase, { org, userOrg }: SeedContext) {
    // Check for existing seed events (not calendars, since the lifecycle hook
    // auto-creates a personal calendar when user_org is created)
    const existingEvents = await pb.collection('calendar_events').getList(1, 1, {
        filter: `created_by = "${userOrg.id}"`,
    })
    if (existingEvents.totalItems > 0) {
        log(`Skipping (${existingEvents.totalItems} events already exist)`)
        return
    }

    const otherMembers = await pb.collection('user_org').getFullList({
        filter: `org = "${org.id}" && id != "${userOrg.id}"`,
    })

    const calendarMap = await seedCalendars(pb, org.id, userOrg.id, otherMembers)

    log(`Creating ${EVENTS.length} events...`)
    await seedEvents(pb, calendarMap, userOrg.id)

    log(`Created ${CALENDARS.length} calendars and ${EVENTS.length} events`)
}
