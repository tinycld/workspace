import type PocketBase from 'pocketbase'

function log(...args: unknown[]) {
    process.stdout.write(`[seed:contacts] ${args.join(' ')}\n`)
}

interface SeedContext {
    userOrg: { id: string }
    org: { id: string }
}

const SAMPLE_LABELS = [
    { name: 'Work', color: '#3949ab' },
    { name: 'Personal', color: '#43a047' },
    { name: 'Important', color: '#d81b60' },
] as const

// Map first_name → labels to assign. Keeps the seed deterministic so
// e2e tests can assert on specific contacts having specific labels.
const CONTACT_LABEL_ASSIGNMENTS: Record<string, readonly string[]> = {
    Alice: ['Work', 'Important'],
    Bob: ['Work'],
    Carol: ['Work', 'Important'],
    Eva: ['Work'],
    Frank: ['Personal'],
    Grace: ['Work'],
    Isabelle: ['Work'],
}

const SAMPLE_CONTACTS = [
    {
        first_name: 'Alice',
        last_name: 'Johnson',
        email: 'alice.johnson@example.com',
        phone: '(555) 123-4567',
        company: 'Acme Corp',
        job_title: 'Product Manager',
        favorite: true,
        notes: 'Met at the annual conference.',
    },
    {
        first_name: 'Bob',
        last_name: 'Smith',
        email: 'bob.smith@example.com',
        phone: '(555) 234-5678',
        company: 'Globex Inc',
        job_title: 'Software Engineer',
        favorite: false,
        notes: '',
    },
    {
        first_name: 'Carol',
        last_name: 'Williams',
        email: 'carol.w@example.com',
        phone: '(555) 345-6789',
        company: 'Initech',
        job_title: 'VP of Sales',
        favorite: true,
        notes: 'Key partner contact.',
    },
    {
        first_name: 'David',
        last_name: 'Brown',
        email: 'david.brown@example.com',
        phone: '',
        company: 'Umbrella LLC',
        job_title: 'Designer',
        favorite: false,
        notes: '',
    },
    {
        first_name: 'Eva',
        last_name: 'Martinez',
        email: 'eva.m@example.com',
        phone: '(555) 567-8901',
        company: 'Acme Corp',
        job_title: 'CTO',
        favorite: false,
        notes: 'Introduced by Alice.',
    },
    {
        first_name: 'Frank',
        last_name: 'Lee',
        email: 'frank.lee@example.com',
        phone: '(555) 678-9012',
        company: '',
        job_title: 'Freelance Consultant',
        favorite: true,
        notes: '',
    },
    {
        first_name: 'Grace',
        last_name: 'Kim',
        email: 'grace.kim@example.com',
        phone: '(555) 789-0123',
        company: 'Stark Industries',
        job_title: 'Marketing Director',
        favorite: false,
        notes: '',
    },
    {
        first_name: 'Henry',
        last_name: 'Taylor',
        email: 'henry.t@example.com',
        phone: '(555) 890-1234',
        company: 'Wayne Enterprises',
        job_title: 'Accountant',
        favorite: false,
        notes: 'Old vendor contact.',
        deleted_at: new Date('2026-03-15').toISOString(),
    },
    {
        first_name: 'Isabelle',
        last_name: 'Nguyen',
        email: 'isabelle.nguyen@example.com',
        phone: '(555) 901-2345',
        company: 'Acme Corp',
        job_title: 'UX Researcher',
        favorite: false,
        notes: 'Works closely with Alice on user studies.',
    },
    {
        first_name: 'James',
        last_name: "O'Connor",
        email: 'james.oconnor@example.com',
        phone: '(555) 012-3456',
        company: 'Globex Inc',
        job_title: 'DevOps Lead',
        favorite: true,
        notes: '',
    },
    {
        first_name: 'Karen',
        last_name: 'Patel',
        email: 'karen.patel@example.com',
        phone: '(555) 111-2233',
        company: 'Soylent Corp',
        job_title: 'Head of HR',
        favorite: false,
        notes: 'Handles vendor onboarding.',
    },
    {
        first_name: 'Leo',
        last_name: 'Chen',
        email: 'leo.chen@example.com',
        phone: '(555) 222-3344',
        company: 'Stark Industries',
        job_title: 'Data Scientist',
        favorite: false,
        notes: '',
    },
    {
        first_name: 'Maria',
        last_name: 'Santos',
        email: 'maria.santos@example.com',
        phone: '(555) 333-4455',
        company: 'Cyberdyne Systems',
        job_title: 'QA Manager',
        favorite: true,
        notes: 'Met at QA Summit 2025.',
    },
    {
        first_name: 'Nathan',
        last_name: 'Wright',
        email: 'nathan.wright@example.com',
        phone: '',
        company: 'Wayne Enterprises',
        job_title: 'Legal Counsel',
        favorite: false,
        notes: '',
    },
    {
        first_name: 'Olivia',
        last_name: 'Fernandez',
        email: 'olivia.f@example.com',
        phone: '(555) 444-5566',
        company: 'Initech',
        job_title: 'Sales Director',
        favorite: false,
        notes: 'Reports to Carol Williams.',
    },
    {
        first_name: 'Paul',
        last_name: 'Anderson',
        email: 'paul.anderson@example.com',
        phone: '(555) 555-6677',
        company: '',
        job_title: 'Independent Contractor',
        favorite: false,
        notes: '',
    },
    {
        first_name: 'Quinn',
        last_name: 'Rivera',
        email: 'quinn.r@example.com',
        phone: '(555) 666-7788',
        company: 'Umbrella LLC',
        job_title: 'Frontend Developer',
        favorite: false,
        notes: 'Works with David on the design system.',
    },
    {
        first_name: 'Rachel',
        last_name: 'Moore',
        email: 'rachel.moore@example.com',
        phone: '(555) 777-8899',
        company: 'Globex Inc',
        job_title: 'Product Designer',
        favorite: true,
        notes: '',
    },
    {
        first_name: 'Sam',
        last_name: 'Hoffman',
        email: 'sam.hoffman@example.com',
        phone: '(555) 888-9900',
        company: 'Soylent Corp',
        job_title: 'Backend Engineer',
        favorite: false,
        notes: '',
    },
    {
        first_name: 'Tina',
        last_name: 'Park',
        email: 'tina.park@example.com',
        phone: '(555) 999-0011',
        company: 'Cyberdyne Systems',
        job_title: 'Program Manager',
        favorite: false,
        notes: 'Coordinates cross-team initiatives.',
    },
    {
        first_name: 'Victor',
        last_name: 'Huang',
        email: 'victor.huang@example.com',
        phone: '',
        company: 'Acme Corp',
        job_title: 'Security Engineer',
        favorite: false,
        notes: '',
        deleted_at: new Date('2026-02-20').toISOString(),
    },
]

export default async function seed(pb: PocketBase, { userOrg, org }: SeedContext) {
    log(`Creating ${SAMPLE_LABELS.length} labels...`)
    const labelIdByName: Record<string, string> = {}
    for (const label of SAMPLE_LABELS) {
        let record: { id: string }
        try {
            record = await pb.collection('labels').getFirstListItem(`org = "${org.id}" && name = "${label.name}"`)
        } catch {
            record = await pb.collection('labels').create({
                org: org.id,
                name: label.name,
                color: label.color,
            })
        }
        labelIdByName[label.name] = record.id
    }

    log(`Creating ${SAMPLE_CONTACTS.length} contacts...`)
    for (const contact of SAMPLE_CONTACTS) {
        const created = await pb.collection('contacts').create({
            ...contact,
            owner: userOrg.id,
        })

        const labelNames = CONTACT_LABEL_ASSIGNMENTS[contact.first_name]
        if (!labelNames) continue
        for (const labelName of labelNames) {
            const labelId = labelIdByName[labelName]
            if (!labelId) continue
            await pb.collection('label_assignments').create({
                label: labelId,
                record_id: created.id,
                collection: 'contacts',
                user_org: userOrg.id,
            })
        }
    }
    log(`Created ${SAMPLE_CONTACTS.length} contacts`)
}
