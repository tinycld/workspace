import { SkeletonLayout } from '@tinycld/core/components/workspace/SkeletonLayout'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useSortedPackages } from '@tinycld/core/lib/use-sorted-packages'
import { Redirect } from 'expo-router'

export default function OrgIndex() {
    const sorted = useSortedPackages()
    const orgHref = useOrgHref()
    const first = sorted[0]

    if (first) {
        return <Redirect href={orgHref(first.slug as never)} />
    }

    return <SkeletonLayout />
}
