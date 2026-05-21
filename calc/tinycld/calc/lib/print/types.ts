import { z } from 'zod'

const sheetsSchema = z.union([
    z.literal('current'),
    z.literal('all'),
    z.object({ ids: z.array(z.string()).min(1) }),
])

const rangeSchema = z.union([z.literal('used'), z.literal('selection')])

const orientationSchema = z.union([z.literal('portrait'), z.literal('landscape')])

const scalingSchema = z.union([
    z.literal('actual'),
    z.literal('fit-width'),
    z.literal('fit-page'),
])

const marginsSchema = z.union([
    z.literal('normal'),
    z.literal('narrow'),
    z.literal('wide'),
])

const repeatRowsSchema = z
    .object({
        from: z.number().int().min(1),
        to: z.number().int().min(1),
    })
    .refine(r => r.from <= r.to, {
        message: 'Repeat-rows: "from" must be <= "to"',
    })
    .nullable()

export const printConfigSchema = z.object({
    scope: z.object({
        sheets: sheetsSchema,
        range: rangeSchema,
    }),
    page: z.object({
        orientation: orientationSchema,
        scaling: scalingSchema,
        margins: marginsSchema,
    }),
    layout: z.object({
        showHeaders: z.boolean(),
        showGridlines: z.boolean(),
        repeatRows: repeatRowsSchema,
    }),
})

export type PrintConfig = z.infer<typeof printConfigSchema>
export type PrintSheetsScope = z.infer<typeof sheetsSchema>
export type PrintRangeScope = z.infer<typeof rangeSchema>
export type PrintOrientation = z.infer<typeof orientationSchema>
export type PrintScaling = z.infer<typeof scalingSchema>
export type PrintMargins = z.infer<typeof marginsSchema>

// The explicit annotation is required: without it, TypeScript widens
// the literal strings ('current', 'portrait', etc.) to `string`, which
// breaks `useForm<PrintConfig>({ defaultValues: ... })` inference at
// every call site.
export const DEFAULT_PRINT_CONFIG: PrintConfig = {
    scope: { sheets: 'current', range: 'used' },
    page: { orientation: 'portrait', scaling: 'fit-width', margins: 'normal' },
    layout: { showHeaders: false, showGridlines: true, repeatRows: null },
}
