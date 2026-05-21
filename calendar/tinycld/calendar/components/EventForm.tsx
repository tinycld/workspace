import { FormErrorSummary, NumberInput, SelectInput, TextAreaInput, TextInput, Toggle } from '@tinycld/core/ui/form'
import { MapPin } from 'lucide-react-native'
import type { Control, FieldErrors } from 'react-hook-form'
import { Controller } from 'react-hook-form'
import { View } from 'react-native'
import type { CalendarWithGroup } from '../types'
import { RecurrencePicker } from './RecurrencePicker'

interface EventFormProps {
    control: Control<{
        title: string
        description: string
        location: string
        startDate: string
        startTime: string
        endDate: string
        endTime: string
        all_day: boolean
        recurrence: string
        calendar: string
        busy_status: 'busy' | 'free'
        visibility: 'default' | 'public' | 'private'
        reminderMinutes: number
    }>
    errors: FieldErrors
    isSubmitted: boolean
    calendars: CalendarWithGroup[]
    startDateValue: string
}

export function EventForm({ control, errors, isSubmitted, calendars, startDateValue }: EventFormProps) {
    const calendarOptions = calendars.map((c) => ({ label: c.name, value: c.id }))
    const eventStartDate = new Date(`${startDateValue || new Date().toISOString().split('T')[0]}T00:00:00`)

    return (
        <View className="gap-4">
            <FormErrorSummary errors={errors} isEnabled={isSubmitted} />

            <TextInput control={control} name="title" label="Title" placeholder="Event title" />

            <Toggle control={control} name="all_day" label="All day" />

            <Controller
                control={control}
                name="recurrence"
                render={({ field }) => (
                    <RecurrencePicker value={field.value} onChange={field.onChange} eventStartDate={eventStartDate} />
                )}
            />

            <TextInput control={control} name="startDate" label="Start date" placeholder="YYYY-MM-DD" />
            <TextInput control={control} name="startTime" label="Start time" placeholder="HH:MM" />
            <TextInput control={control} name="endDate" label="End date" placeholder="YYYY-MM-DD" />
            <TextInput control={control} name="endTime" label="End time" placeholder="HH:MM" />

            <TextInput
                control={control}
                name="location"
                label="Location"
                labelIcon={MapPin}
                placeholder="Add location"
            />

            <NumberInput
                control={control}
                name="reminderMinutes"
                label="Reminder (minutes)"
                min={0}
                max={10080}
                increment={5}
            />

            <SelectInput control={control} name="calendar" label="Calendar" options={calendarOptions} />

            <SelectInput
                control={control}
                name="busy_status"
                label="Status"
                options={[
                    { label: 'Busy', value: 'busy' },
                    { label: 'Free', value: 'free' },
                ]}
                horizontal
            />

            <SelectInput
                control={control}
                name="visibility"
                label="Visibility"
                options={[
                    { label: 'Default', value: 'default' },
                    { label: 'Public', value: 'public' },
                    { label: 'Private', value: 'private' },
                ]}
                horizontal
            />

            <TextAreaInput
                control={control}
                name="description"
                label="Description"
                placeholder="Add description"
                numberOfLines={4}
            />
        </View>
    )
}
