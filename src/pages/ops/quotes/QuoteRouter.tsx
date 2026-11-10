import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { supabase } from '@/lib/supabase'
import { Spinner } from '@/components/ui/Spinner'
import { QuoteEditor } from './QuoteEditor'
import { BuilderQuoteSummary } from './BuilderQuoteSummary'

// Divert builder-source quotes to the read-only summary. Native quotes
// (incl. new quotes without an id yet) go to the editor.
export function QuoteRouter() {
  const { id } = useParams<{ id: string }>()

  const { data: source } = useQuery({
    queryKey: ['quote-source', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data } = await supabase.from('quotes').select('source').eq('id', id!).maybeSingle()
      return (data as { source?: string } | null)?.source ?? 'native'
    },
  })

  if (!id) return <QuoteEditor />
  if (source === undefined) return <div className="p-8"><Spinner size={16} /></div>
  return source === 'builder' ? <BuilderQuoteSummary /> : <QuoteEditor />
}
