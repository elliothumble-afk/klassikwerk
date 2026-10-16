import { useState } from 'react'
import { Link } from 'react-router'
import { PlatformsTab } from './PlatformsTab'
import { TiersTab } from './TiersTab'
import { OptionsTab } from './OptionsTab'
import { useOpsBuilderSelection } from '@/lib/opsBuilderSelection'

type Tab = 'platforms' | 'tiers' | 'options'

const TABS: { id: Tab; label: string }[] = [
  { id: 'platforms', label: 'Platforms' },
  { id: 'tiers', label: 'Tiers' },
  { id: 'options', label: 'Options' },
]

export function CatalogPage() {
  const [active, setActive] = useState<Tab>('platforms')
  const { selected } = useOpsBuilderSelection()
  const isConnect = selected?.catalog_source === 'connect'

  return (
    <div className="p-8">
      <div className="max-w-6xl mx-auto">
        <h1
          className="text-2xl text-[var(--color-foreground)] mb-6"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Catalog
        </h1>

        {isConnect && selected && (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-accent-light)] p-4 mb-6 text-sm">
            <strong className="font-medium">Managed by Connect.</strong>{' '}
            This catalog is synced from an external feed. Rows marked{' '}
            <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--color-surface-raised)]">synced</span>{' '}
            will be re-written on the next sync — edit source data in Connect, or run{' '}
            <Link to={`/ops/builders/${selected.id}/brand`} className="underline">Sync now</Link>.
          </div>
        )}

        {/* Tab bar */}
        <div className="flex gap-1 p-1 bg-[var(--color-surface-raised)] rounded-[var(--radius-md)] w-fit mb-8">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={`
                px-4 py-1.5 rounded-[var(--radius-sm)] text-sm font-medium transition
                ${active === tab.id
                  ? 'bg-[var(--color-surface)] text-[var(--color-foreground)] shadow-sm'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {active === 'platforms' && <PlatformsTab />}
        {active === 'tiers' && <TiersTab />}
        {active === 'options' && <OptionsTab />}
      </div>
    </div>
  )
}
