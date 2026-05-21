export { useLabels } from '@tinycld/core/ui/hooks/useLabels'

import { useLabelsForRecord } from '@tinycld/core/ui/hooks/useLabels'

export function useThreadLabels(threadStateId: string) {
    return useLabelsForRecord(threadStateId, 'mail_thread_state')
}
