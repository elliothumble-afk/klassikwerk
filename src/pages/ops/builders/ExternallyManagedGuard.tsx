import { Navigate } from 'react-router'
import { useOpsBuilderSelection } from '@/lib/opsBuilderSelection'
import { Spinner } from '@/components/ui/Spinner'

interface Props {
  // When a page is "builder-only" (available to fully-managed builders
  // only), wrap it in this guard with `allowManaged={false}` (the
  // default). An externally-managed selection is bounced to the
  // builder's dashboard — Settings handles the parts HH still needs.
  //
  // Set `allowManaged` when you WANT the page accessible to both
  // kinds of builder; this component only redirects when the current
  // selection is externally-managed AND the page isn't allowed.
  allowManaged?: boolean
  children: React.ReactNode
}

export function ExternallyManagedGuard({ allowManaged = false, children }: Props) {
  const { selected, loading } = useOpsBuilderSelection()
  if (loading) return <div className="p-8"><Spinner size={16} /></div>
  if (!selected) return <Navigate to="/ops" replace />
  if (!allowManaged && selected.managed_externally) {
    // The builder is externally-managed and this route is
    // builder-only. Dashboard shows pipeline-from-Connect data; this
    // keeps the user from reaching catalog/builds/costing surfaces.
    return <Navigate to="/ops/dashboard" replace />
  }
  return <>{children}</>
}
