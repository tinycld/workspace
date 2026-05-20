import { z } from 'zod'

export const contactSchema = z.object({
    first_name: z.string().min(1, 'First name is required'),
    last_name: z.string(),
    email: z.string().email('Invalid email address').or(z.literal('')),
    phone: z.string(),
    company: z.string(),
    job_title: z.string(),
    notes: z.string(),
    favorite: z.boolean(),
})
