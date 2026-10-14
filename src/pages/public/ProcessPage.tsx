import { useBuilder } from '@/lib/builderContext'

export function ProcessPage() {
  const { bundle } = useBuilder()
  if (!bundle) return null
  const stages = bundle.brand.process_copy ?? []

  return (
    <section className="max-w-4xl mx-auto px-6 py-16">
      <h1
        className="text-3xl text-[var(--color-foreground)] mb-10"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        How it works
      </h1>
      <ol className="space-y-6">
        {stages.map((stage, i) => (
          <li key={stage.label} className="flex gap-6">
            <span
              className="shrink-0 h-9 w-9 rounded-full flex items-center justify-center text-sm bg-[var(--color-surface)] border border-[var(--color-border)]"
            >
              {i + 1}
            </span>
            <div>
              <h2
                className="text-lg text-[var(--color-foreground)] mb-1"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {stage.label}
              </h2>
              <p className="text-sm text-[var(--color-muted)] max-w-xl">{stage.copy}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
