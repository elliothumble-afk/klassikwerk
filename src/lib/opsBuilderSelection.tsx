import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Builder } from '@/types/database'

interface OpsBuilderSelectionValue {
  /** Active builders only — the surface the Workspace dropdown uses. */
  builders: Builder[]
  /** Full list including inactive — the Operator → Builders admin view
   *  reads this so admins can still reach an inactive row. */
  allBuilders: Builder[]
  /** Currently-pinned builder. Null when the user is on My homepage
   *  OR when the persisted pin resolved to an inactive row (in which
   *  case the sidebar falls back to My homepage). */
  selected: Builder | null
  loading: boolean
  /** Pass a builder id to pin the sidebar to a builder, or null to
   *  clear the selection and return to the cross-builder (My homepage)
   *  view. */
  setSelectedId: (id: string | null) => void
}

const OpsBuilderSelectionContext = createContext<OpsBuilderSelectionValue>({
  builders: [],
  allBuilders: [],
  selected: null,
  loading: true,
  setSelectedId: () => {},
})

const STORAGE_KEY = 'ops.selectedBuilderId'

export function OpsBuilderSelectionProvider({ children }: { children: ReactNode }) {
  // Default-null on load. The sidebar selector is the only way to
  // enter a builder's context; new logins always start on My homepage
  // per the Phase 9 §1 nav rules.
  const [selectedId, setSelectedIdState] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(STORAGE_KEY) || null
  })

  const { data: builders, isLoading } = useQuery({
    queryKey: ['ops', 'builders', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('builders').select('*').order('sort')
      if (error) throw error
      return (data ?? []) as Builder[]
    },
    staleTime: 30_000,
  })

  // The dropdown only shows active builders — inactive ones are
  // reachable from Operator → Builders. The full list (incl. inactive)
  // is kept as `allBuilders` on the context for places that need it
  // (BuildersList, deep-link resolution on /ops/builders/:id/*).
  const allBuilders = builders ?? []
  const list = allBuilders.filter(b => b.active)
  const selected = selectedId ? (allBuilders.find(b => b.id === selectedId) ?? null) : null
  // A selection that resolves to an inactive builder is treated as
  // "no selection" for sidebar purposes — the dropdown falls back to
  // My homepage. Active builders in `list` keep the selection as-is.
  const activeSelected = selected && selected.active ? selected : null

  // Clear storage if the pinned id no longer resolves to a real builder
  // OR resolves to an inactive one. Rule: Workspace dropdown reflects
  // only active rows, so persisting an inactive selection would just
  // leave the dropdown stuck on My homepage without visual feedback.
  useEffect(() => {
    if (selectedId && allBuilders.length > 0) {
      const match = allBuilders.find(b => b.id === selectedId)
      if (!match || !match.active) {
        setSelectedIdState(null)
        if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY)
      }
    }
  }, [selectedId, allBuilders])

  function setSelectedId(id: string | null) {
    setSelectedIdState(id)
    if (typeof window === 'undefined') return
    if (id) window.localStorage.setItem(STORAGE_KEY, id)
    else window.localStorage.removeItem(STORAGE_KEY)
  }

  const value = useMemo(
    () => ({ builders: list, allBuilders, selected: activeSelected, loading: isLoading, setSelectedId }),
    [list, allBuilders, activeSelected, isLoading]
  )

  return <OpsBuilderSelectionContext.Provider value={value}>{children}</OpsBuilderSelectionContext.Provider>
}

export function useOpsBuilderSelection() {
  return useContext(OpsBuilderSelectionContext)
}
