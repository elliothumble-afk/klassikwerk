import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import { Plus, ToggleLeft, ToggleRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import type { Builder } from '@/types/database'

export function BuildersList() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: builders, isLoading } = useQuery({
    queryKey: ['ops', 'builders', 'list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('builders').select('*').order('sort')
      if (error) throw error
      return (data ?? []) as Builder[]
    },
  })

  const toggleActive = useMutation({
    mutationFn: async (b: Builder) => {
      const { error } = await supabase.from('builders').update({ active: !b.active }).eq('id', b.id)
      if (error) throw error
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['ops', 'builders'] })
    },
  })

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl text-[var(--color-foreground)]" style={{ fontFamily: 'var(--font-display)' }}>
            Builders
          </h1>
          <button
            onClick={() => navigate('/ops/builders/new')}
            className="flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm hover:opacity-90"
          >
            <Plus size={14} /> Add builder
          </button>
        </div>

        {isLoading ? (
          <Spinner size={20} className="text-[var(--color-muted)]" />
        ) : !builders || builders.length === 0 ? (
          <EmptyState title="No builders yet" description="Add your first builder." />
        ) : (
          <div className="bg-[var(--color-surface)] rounded-[var(--radius-lg)] border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className="text-left px-5 py-3 text-xs font-medium text-[var(--color-muted)]">Name</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-[var(--color-muted)]">Slug</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-[var(--color-muted)]">Status</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-[var(--color-muted)]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {builders.map(b => (
                  <tr key={b.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-5 py-3">
                      <Link
                        to={`/ops/builders/${b.id}/brand`}
                        className="font-medium text-[var(--color-foreground)] hover:underline"
                      >
                        {b.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-[var(--color-muted)] font-mono text-xs">{b.slug}</td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => toggleActive.mutate(b)}
                        className={`inline-flex items-center gap-1 text-xs ${
                          b.active ? 'text-[var(--color-success)]' : 'text-[var(--color-muted)]'
                        }`}
                      >
                        {b.active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                        {b.active ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="px-5 py-3 text-right space-x-3">
                      <Link
                        to={`/ops/builders/${b.id}/costing`}
                        className="text-xs text-[var(--color-muted)] hover:underline"
                      >
                        Costing
                      </Link>
                      <Link
                        to={`/b/${b.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-[var(--color-accent)] hover:underline"
                      >
                        View site →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
