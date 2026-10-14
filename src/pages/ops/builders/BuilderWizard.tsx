import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, Link } from 'react-router'
import { supabase } from '@/lib/supabase'
import type { Builder } from '@/types/database'

const STEPS = ['Identity', 'Brand', 'Terms', 'Contract', 'Done'] as const
type Step = typeof STEPS[number]

const DEFAULT_PROCESS = [
  { label: 'Configure', copy: 'Choose a platform, a tier, and the specification.' },
  { label: 'Reserve',   copy: 'Hold your slot with a refundable deposit.' },
  { label: 'Intake',    copy: 'Donor car sourced or supplied, inspected, documented.' },
  { label: 'Samples',   copy: 'Paint, leather, wood and wheel samples signed off.' },
  { label: 'Contract',  copy: 'Final specification locked. Work authorization signed.' },
  { label: 'Build',     copy: 'The car is restored to the agreed specification.' },
  { label: 'Delivery',  copy: 'Hand-over at our workshop or your door.' },
  { label: 'Aftercare', copy: 'Workmanship warranty and ongoing support.' },
]

const GENERIC_CONTRACT = `# Work Authorization

**Builder:** {{builder_legal_name}}
**Customer:** {{customer_full_name}}

## Vehicle

- Platform: {{vehicle_platform}}
- VIN: {{vehicle_vin}}
- Year: {{vehicle_year}}

## Configuration

{{configuration_table}}

## Price

Total: {{price_total}}

{{payment_schedule_table}}

## Warranty

{{warranty_text}}

Governed by the laws of {{governing_law}}.

Customer signature: ______________________________   Date: ______________
`

interface WizardState {
  // Identity
  name: string
  slug: string
  legal_name: string
  // Brand
  wordmark_text: string
  tagline: string
  color_accent: string
  color_bg: string
  color_text: string
  font_display: string
  font_body: string
  logo_url: string
  // Terms
  reservation_dollars: number
  warranty_text: string
  governing_law: string
  lead_time_copy: string
  schedule: { label: string; percent: number; trigger: string }[]
  // Contract
  contract_markdown: string
}

export function BuilderWizard() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [step, setStep] = useState<Step>('Identity')
  const [state, setState] = useState<WizardState>({
    name: '',
    slug: '',
    legal_name: '',
    wordmark_text: '',
    tagline: '',
    color_accent: '#2E3B2B',
    color_bg: '#FAF8F4',
    color_text: '#1C1C1A',
    font_display: 'Fraunces',
    font_body: 'Inter',
    logo_url: '',
    reservation_dollars: 1000,
    warranty_text: '',
    governing_law: 'State of Florida',
    lead_time_copy: '',
    schedule: [
      { label: 'Contract signing', percent: 50, trigger: 'contract' },
      { label: 'Delivery',         percent: 50, trigger: 'delivery' },
    ],
    contract_markdown: GENERIC_CONTRACT,
  })
  const [createdBuilder, setCreatedBuilder] = useState<Builder | null>(null)

  function up<K extends keyof WizardState>(key: K, value: WizardState[K]) {
    setState(s => ({ ...s, [key]: value }))
  }

  const create = useMutation({
    mutationFn: async () => {
      const operatorRes = await supabase.from('operators').select('id').limit(1).single()
      if (operatorRes.error) throw operatorRes.error
      const operatorId = operatorRes.data.id

      const builderIns = await supabase
        .from('builders')
        .insert({
          operator_id: operatorId,
          slug: state.slug,
          name: state.name,
          legal_name: state.legal_name || state.name,
          active: true,
          sort: 100,
        })
        .select('*')
        .single()
      if (builderIns.error) throw builderIns.error
      const builder = builderIns.data as Builder

      const brandIns = await supabase.from('builder_brand').insert({
        builder_id: builder.id,
        logo_url: state.logo_url || null,
        wordmark_text: state.wordmark_text || state.name,
        color_accent: state.color_accent,
        color_bg: state.color_bg,
        color_text: state.color_text,
        font_display: state.font_display,
        font_body: state.font_body,
        tagline: state.tagline || null,
        process_copy: DEFAULT_PROCESS,
      })
      if (brandIns.error) throw brandIns.error

      const termsIns = await supabase.from('builder_terms').insert({
        builder_id: builder.id,
        reservation_cents: Math.round(state.reservation_dollars * 100),
        payment_schedule: state.schedule,
        warranty_text: state.warranty_text || null,
        governing_law: state.governing_law || null,
        lead_time_copy: state.lead_time_copy || null,
        currency: 'usd',
      })
      if (termsIns.error) throw termsIns.error

      const contractIns = await supabase.from('contract_templates').insert({
        builder_id: builder.id,
        version: 1,
        title: 'Work Authorization',
        body_markdown: state.contract_markdown,
        merge_fields: [
          'builder_legal_name', 'customer_full_name', 'vehicle_platform', 'vehicle_vin',
          'vehicle_year', 'configuration_table', 'price_total', 'payment_schedule_table',
          'warranty_text', 'governing_law',
        ],
        is_current: true,
      })
      if (contractIns.error) throw contractIns.error

      return builder
    },
    onSuccess: builder => {
      setCreatedBuilder(builder)
      setStep('Done')
      qc.invalidateQueries({ queryKey: ['ops', 'builders'] })
    },
  })

  const label = `h-9 px-3 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-sm`

  return (
    <div className="p-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl text-[var(--color-foreground)] mb-2" style={{ fontFamily: 'var(--font-display)' }}>
          New builder
        </h1>
        <ol className="flex gap-2 text-xs mb-8">
          {STEPS.map(s => (
            <li
              key={s}
              className={`px-2 py-1 rounded ${
                step === s
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'bg-[var(--color-surface-raised)] text-[var(--color-muted)]'
              }`}
            >
              {s}
            </li>
          ))}
        </ol>

        {step === 'Identity' && (
          <section className="space-y-3">
            <Field label="Name">
              <input value={state.name} onChange={e => up('name', e.target.value)} className={label} placeholder="Theon Design" />
            </Field>
            <Field label="Slug">
              <input value={state.slug} onChange={e => up('slug', e.target.value.replace(/[^a-z0-9-]/g, ''))} className={label} placeholder="theon-design" />
            </Field>
            <Field label="Legal name">
              <input value={state.legal_name} onChange={e => up('legal_name', e.target.value)} className={label} />
            </Field>
            <StepNav canNext={state.name.length > 0 && state.slug.length > 0} onNext={() => setStep('Brand')} />
          </section>
        )}

        {step === 'Brand' && (
          <section className="space-y-3">
            <Field label="Wordmark text">
              <input value={state.wordmark_text} onChange={e => up('wordmark_text', e.target.value)} className={label} />
            </Field>
            <Field label="Logo URL">
              <input value={state.logo_url} onChange={e => up('logo_url', e.target.value)} className={label} placeholder="https://…" />
            </Field>
            <Field label="Tagline">
              <input value={state.tagline} onChange={e => up('tagline', e.target.value)} className={label} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Accent"><input type="color" value={state.color_accent} onChange={e => up('color_accent', e.target.value)} className="h-9 w-full" /></Field>
              <Field label="Background"><input type="color" value={state.color_bg} onChange={e => up('color_bg', e.target.value)} className="h-9 w-full" /></Field>
              <Field label="Text"><input type="color" value={state.color_text} onChange={e => up('color_text', e.target.value)} className="h-9 w-full" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Display font (Google Fonts)">
                <input value={state.font_display} onChange={e => up('font_display', e.target.value)} className={label} />
              </Field>
              <Field label="Body font">
                <input value={state.font_body} onChange={e => up('font_body', e.target.value)} className={label} />
              </Field>
            </div>
            <BrandPreview state={state} />
            <StepNav onPrev={() => setStep('Identity')} onNext={() => setStep('Terms')} canNext />
          </section>
        )}

        {step === 'Terms' && (
          <section className="space-y-3">
            <Field label="Reservation (USD)">
              <input type="number" value={state.reservation_dollars} onChange={e => up('reservation_dollars', Number(e.target.value))} className={label} />
            </Field>
            <Field label="Warranty text">
              <textarea value={state.warranty_text} onChange={e => up('warranty_text', e.target.value)} className={`${label} h-20 py-2`} />
            </Field>
            <Field label="Governing law">
              <input value={state.governing_law} onChange={e => up('governing_law', e.target.value)} className={label} />
            </Field>
            <Field label="Lead-time copy">
              <input value={state.lead_time_copy} onChange={e => up('lead_time_copy', e.target.value)} className={label} />
            </Field>
            <ScheduleEditor schedule={state.schedule} onChange={s => up('schedule', s)} />
            <StepNav onPrev={() => setStep('Brand')} onNext={() => setStep('Contract')} canNext />
          </section>
        )}

        {step === 'Contract' && (
          <section className="space-y-3">
            <p className="text-xs text-[var(--color-muted)]">
              Markdown. Merge-field placeholders use <code>{'{{field}}'}</code> syntax.
            </p>
            <textarea
              value={state.contract_markdown}
              onChange={e => up('contract_markdown', e.target.value)}
              className="w-full h-80 px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] font-mono text-xs"
            />
            <StepNav
              onPrev={() => setStep('Terms')}
              canNext={!create.isPending}
              onNext={() => create.mutate()}
              nextLabel={create.isPending ? 'Creating…' : 'Create builder'}
            />
            {create.error && (
              <p className="text-xs text-[var(--color-danger)]">{(create.error as Error).message}</p>
            )}
          </section>
        )}

        {step === 'Done' && createdBuilder && (
          <section>
            <h2 className="text-xl mb-3" style={{ fontFamily: 'var(--font-display)' }}>
              Builder created
            </h2>
            <p className="text-sm text-[var(--color-muted)] mb-4">
              {createdBuilder.name} is live.
            </p>
            <div className="flex items-center gap-3">
              <Link
                to={`/b/${createdBuilder.slug}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center h-9 px-4 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm hover:opacity-90"
              >
                Open public site
              </Link>
              <button
                onClick={() => navigate(`/ops/builders/${createdBuilder.id}/brand`)}
                className="inline-flex items-center h-9 px-4 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-sm hover:bg-[var(--color-surface-raised)]"
              >
                Edit brand
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-[var(--color-muted)] block mb-1">{label}</label>
      {children}
    </div>
  )
}

function StepNav({
  onPrev,
  onNext,
  canNext,
  nextLabel = 'Next',
}: {
  onPrev?: () => void
  onNext?: () => void
  canNext?: boolean
  nextLabel?: string
}) {
  return (
    <div className="flex items-center justify-between mt-5">
      {onPrev ? (
        <button onClick={onPrev} className="text-sm text-[var(--color-muted)] hover:text-[var(--color-foreground)]">
          ← Back
        </button>
      ) : <span />}
      {onNext && (
        <button
          onClick={onNext}
          disabled={!canNext}
          className="h-9 px-4 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm disabled:opacity-50"
        >
          {nextLabel}
        </button>
      )}
    </div>
  )
}

function ScheduleEditor({
  schedule,
  onChange,
}: {
  schedule: { label: string; percent: number; trigger: string }[]
  onChange: (s: { label: string; percent: number; trigger: string }[]) => void
}) {
  function up(i: number, patch: Partial<{ label: string; percent: number; trigger: string }>) {
    const next = [...schedule]
    next[i] = { ...next[i], ...patch }
    onChange(next)
  }

  function add() {
    onChange([...schedule, { label: '', percent: 0, trigger: '' }])
  }

  function remove(i: number) {
    onChange(schedule.filter((_, idx) => idx !== i))
  }

  const total = schedule.reduce((sum, s) => sum + (Number(s.percent) || 0), 0)

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 bg-[var(--color-surface)]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[var(--color-muted)]">Payment schedule</span>
        <span className={`text-xs ${total === 100 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>
          Total {total}%
        </span>
      </div>
      <div className="space-y-2">
        {schedule.map((s, i) => (
          <div key={i} className="grid grid-cols-[1fr_80px_1fr_30px] gap-2 items-center">
            <input value={s.label} onChange={e => up(i, { label: e.target.value })} placeholder="Label" className="h-8 px-2 border border-[var(--color-border)] rounded-[var(--radius-sm)] text-sm bg-[var(--color-background)]" />
            <input type="number" value={s.percent} onChange={e => up(i, { percent: Number(e.target.value) })} className="h-8 px-2 border border-[var(--color-border)] rounded-[var(--radius-sm)] text-sm bg-[var(--color-background)]" />
            <input value={s.trigger} onChange={e => up(i, { trigger: e.target.value })} placeholder="trigger (e.g. contract)" className="h-8 px-2 border border-[var(--color-border)] rounded-[var(--radius-sm)] text-sm bg-[var(--color-background)]" />
            <button onClick={() => remove(i)} className="text-xs text-[var(--color-muted)] hover:text-[var(--color-danger)]">×</button>
          </div>
        ))}
      </div>
      <button onClick={add} className="mt-2 text-xs text-[var(--color-accent)] hover:underline">+ Add step</button>
    </div>
  )
}

function BrandPreview({ state }: { state: WizardState }) {
  return (
    <div
      className="rounded-[var(--radius-md)] p-5 border"
      style={{
        backgroundColor: state.color_bg,
        color: state.color_text,
        borderColor: state.color_text + '33',
      }}
    >
      <div style={{ fontFamily: `'${state.font_display}', Georgia, serif` }} className="text-2xl mb-1">
        {state.wordmark_text || state.name || 'Preview'}
      </div>
      <div style={{ fontFamily: `'${state.font_body}', system-ui, sans-serif` }} className="text-sm opacity-70">
        {state.tagline || 'Tagline preview'}
      </div>
      <div className="mt-3">
        <span
          className="inline-block px-3 py-1 rounded-sm text-sm text-white"
          style={{ backgroundColor: state.color_accent }}
        >
          Accent sample
        </span>
      </div>
    </div>
  )
}
