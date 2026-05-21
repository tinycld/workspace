import type { ReactNode } from 'react'
import { useEventReminders } from './hooks/useEventReminders'

function EventReminders() {
    useEventReminders()
    return null
}

export default function CalendarProvider({ children }: { children: ReactNode }) {
    return (
        <>
            <EventReminders />
            {children}
        </>
    )
}
