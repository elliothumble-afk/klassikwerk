import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Builder } from '@/types/database'

interface OpsBuilderSelectionValue {
  builders: Builder[]
  selected: Builder | null
  loading: boolean
  /** Pass a builder id to pin the sidebar to a builder, or null to
   *  clear the selection and return to the cross-builder (My homepage)
   *  view. */
  setSelectedId: (id: string | null) => void
}

const OpsBuilderSelectionContext = createContext<OpsBuilderSelectionValue>({
  builders: [],
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

  const list = builders ?? []
  const selected = selectedId ? (list.find(b => b.id === selectedId) ?? null) : null

  // Clear storage if the pinned id no longer resolves to a real builder
  // (e.g. the row got deactivated or deleted between sessions).
  useEffect(() => {
    if (selectedId && list.length > 0 && !list.find(b => b.id === selectedId)) {
      setSelectedIdState(null)
      if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY)
    }
  }, [selectedId, list])

  function setSelectedId(id: string | null) {
    setSelectedIdState(id)
    if (typeof window === 'undefined') return
    if (id) window.localStorage.setItem(STORAGE_KEY, id)
    else window.localStorage.removeItem(STORAGE_KEY)
  }

  const value = useMemo(
    () => ({ builders: list, selected, loading: isLoading, setSelectedId }),
    [list, selected, isLoading]
  )

  return <OpsBuilderSelectionContext.Provider value={value}>{children}</OpsBuilderSelectionContext.Provider>
}

export function useOpsBuilderSelection() {
  return useContext(OpsBuilderSelectionContext)
}
