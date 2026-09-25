import { useState } from 'react'
import { PlatformsTab } from './PlatformsTab'
import { TiersTab } from './TiersTab'
import { OptionsTab } from './OptionsTab'

type Tab = 'platforms' | 'tiers' | 'options'

const TABS: { id: Tab; label: string }[] = [
  { id: 'platforms', label: 'Platforms' },
  { id: 'tiers', label: 'Tiers' },
  { id: 'options', label: 'Options' },
]

export function CatalogPage() {
  const [active, setActive] = useState<Tab>('platforms')

  return (
    <div className="p-8">
      <div className="max-w-6xl mx-auto">
        <h1
          className="text-2xl text-[var(--color-foreground)] mb-6"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Catalog
        </h1>

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
