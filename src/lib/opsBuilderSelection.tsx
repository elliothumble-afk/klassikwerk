import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Builder } from '@/types/database'

interface OpsBuilderSelectionValue {
  builders: Builder[]
  selected: Builder | null
  loading: boolean
  setSelectedId: (id: string) => void
}

const OpsBuilderSelectionContext = createContext<OpsBuilderSelectionValue>({
  builders: [],
  selected: null,
  loading: true,
  setSelectedId: () => {},
})

const STORAGE_KEY = 'ops.selectedBuilderId'

export function OpsBuilderSelectionProvider({ children }: { children: ReactNode }) {
  const [selectedId, setSelectedIdState] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : window.localStorage.getItem(STORAGE_KEY)
  )

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
  const selected = list.find(b => b.id === selectedId) ?? list[0] ?? null

  useEffect(() => {
    if (selected && selected.id !== selectedId) {
      setSelectedIdState(selected.id)
    }
  }, [selected, selectedId])

  function setSelectedId(id: string) {
    setSelectedIdState(id)
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, id)
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
