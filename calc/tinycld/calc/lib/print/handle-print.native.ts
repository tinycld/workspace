// TODO: switch to `import { Print } from '@tinycld/core/lib/print'`
// once the core re-export lands (tracked separately — for now, expo-print
// is a direct peer dep of the app shell).
import * as Print from 'expo-print'
import { captureException } from '@tinycld/core/lib/errors'

// handlePrint (native) hands the HTML to expo-print, which routes to
// AirPrint on iOS and the system print framework on Android. Both
// platform UIs offer "Save as PDF" / "Save to Files" natively, so
// users get PDF export for free.
//
// Cancel is the common error case — expo-print rejects when the user
// dismisses the print sheet without confirming. We surface only true
// errors (unavailable AirPrint, IO failures) to telemetry.
export async function handlePrint(html: string): Promise<void> {
    try {
        await Print.printAsync({ html })
    } catch (err) {
        if (isCancellation(err)) return
        captureException('handlePrint', err)
    }
}

function isCancellation(err: unknown): boolean {
    if (err == null || typeof err !== 'object') return false
    const message = (err as { message?: unknown }).message
    if (typeof message !== 'string') return false
    return /cancel/i.test(message) || /dismiss/i.test(message)
}
