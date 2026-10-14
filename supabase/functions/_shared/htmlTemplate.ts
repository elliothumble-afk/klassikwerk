// Shared HTML templates for the quote and contract PDFs.
// Both share a brand chrome (header, fonts, colours, footer with the
// operator contact block).

// deno-lint-ignore-file no-explicit-any

export interface BrandLike {
  wordmark_text: string | null
  logo_url: string | null
  tagline: string | null
  color_accent: string
  color_bg: string
  color_text: string
  font_display: string
  font_body: string
  process_copy: { label: string; copy: string }[]
}

export interface TermsLike {
  reservation_cents: number
  payment_schedule: { label: string; percent: number; trigger: string }[]
  warranty_text: string | null
  governing_law: string | null
  lead_time_copy: string | null
  currency: string
  quote_validity_days: number
  quote_intro_copy: string | null
  brochure_url: string | null
}

export interface OperatorContact {
  name?: string
  person?: string
  email?: string
  phone?: string
  website?: string
  address?: string
}

export interface BuilderLike { name: string; legal_name: string | null; slug: string }

export interface PlatformLike { name: string; chassis: string; years: string; hero_image_url: string | null }

export interface TierLike { name: string; base_price_cents: number | null }

export interface OptionLine {
  group_name: string
  name: string
  code: string | null
  swatch_image_url: string | null
  price_cents_at_selection: number
  included: boolean
}

export interface CustomerLike { full_name: string | null; email: string | null }

export interface QuoteTemplateInput {
  version: number
  price_cents: number
  created_at: string
  builder: BuilderLike
  brand: BrandLike
  terms: TermsLike
  operator_contact: OperatorContact
  platform: PlatformLike
  tier: TierLike
  options: OptionLine[]
  customer: CustomerLike | null
  customer_phone: string | null
}

export interface ContractTemplateInput {
  title: string
  version: number
  body_html: string
  builder: BuilderLike
  brand: BrandLike
  operator_contact: OperatorContact
}

// ──────────────────────────────────────────────────────────────────────
// Formatting helpers
// ──────────────────────────────────────────────────────────────────────

function money(cents: number | null | undefined, currency = 'usd'): string {
  if (cents == null) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function googleFontUrl(display: string, body: string): string {
  const toParam = (family: string) =>
    `family=${family.replace(/\s+/g, '+')}:wght@400;500;600`
  return `https://fonts.googleapis.com/css2?${toParam(display)}&${toParam(body)}&display=swap`
}

function pageChrome(brand: BrandLike, body: string, operator: OperatorContact, builder: BuilderLike): string {
  const fontUrl = googleFontUrl(brand.font_display, brand.font_body)
  const bg = brand.color_bg
  const fg = brand.color_text
  const accent = brand.color_accent
  const display = brand.font_display
  const bodyFont = brand.font_body
  const contactLine = [operator.person, operator.email, operator.phone, operator.website]
    .filter(Boolean)
    .map(s => escapeHtml(String(s)))
    .join(' · ')
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="${fontUrl}" rel="stylesheet" />
<style>
  :root {
    --bg: ${bg};
    --fg: ${fg};
    --accent: ${accent};
    --muted: #6B6B67;
    --surface: #FFFFFF;
    --border: rgba(0,0,0,0.08);
    --font-display: '${display}', Georgia, serif;
    --font-body: '${bodyFont}', system-ui, sans-serif;
  }
  @page { size: Letter; margin: 0.6in 0.5in; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); font-family: var(--font-body); font-size: 11.5pt; line-height: 1.5; }
  h1, h2, h3 { font-family: var(--font-display); font-weight: 400; letter-spacing: -0.01em; margin: 0 0 0.5em; }
  h1 { font-size: 32pt; line-height: 1.1; }
  h2 { font-size: 18pt; margin-top: 1.6em; }
  h3 { font-size: 13pt; margin-top: 1.2em; color: var(--accent); }
  p { margin: 0 0 0.8em; }
  .muted { color: var(--muted); }
  .small { font-size: 9.5pt; }
  .accent { color: var(--accent); }
  .rule { height: 1px; background: var(--border); margin: 1.2em 0; }
  .page-break { page-break-before: always; }
  .no-break { break-inside: avoid; page-break-inside: avoid; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 10px 0; border-bottom: 1px solid var(--border); vertical-align: middle; }
  th { font-size: 9.5pt; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 500; }
  td.price { text-align: right; white-space: nowrap; }
  .brand-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 1em;
    border-bottom: 1px solid var(--border);
    margin-bottom: 1.6em;
  }
  .wordmark { font-family: var(--font-display); font-size: 20pt; letter-spacing: 0.01em; }
  .brand-header img { height: 36px; width: auto; }
  .brand-tagline { font-size: 9.5pt; color: var(--muted); font-family: var(--font-body); margin-top: 2px; }
  .cover {
    margin-top: 0.5em;
    background: var(--surface);
    border-radius: 8px;
    overflow: hidden;
  }
  .hero {
    width: 100%;
    height: 320px;
    background-size: cover;
    background-position: center;
    background-color: #f0ede6;
  }
  .cover .meta {
    padding: 28px 28px 32px;
  }
  .cover h1 { margin-bottom: 0.3em; }
  .cover .meta .row { display: flex; gap: 24px; margin-top: 18px; }
  .cover .meta .row > div { flex: 1; }
  .cover .meta .row .label { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 4px; }
  .section { margin-top: 1.8em; }
  .swatch {
    width: 36px; height: 36px; border-radius: 4px; object-fit: cover; background: #efece6;
    display: inline-block; vertical-align: middle;
  }
  .option-row { display: flex; align-items: center; gap: 12px; }
  .total-strip {
    display: flex; justify-content: space-between; align-items: baseline;
    padding: 16px 20px; margin-top: 1.2em;
    background: var(--surface); border-radius: 8px;
  }
  .total-strip .total-label { font-size: 9.5pt; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
  .total-strip .total-value { font-family: var(--font-display); font-size: 28pt; color: var(--fg); }
  .process-grid {
    display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px;
  }
  .process-step {
    padding: 16px 18px; background: var(--surface); border-radius: 6px; border: 1px solid var(--border);
    break-inside: avoid;
  }
  .process-step .n { font-family: var(--font-display); font-size: 22pt; color: var(--accent); line-height: 1; }
  .process-step .label { font-weight: 500; margin-top: 6px; }
  .process-step .copy { color: var(--muted); font-size: 10.5pt; margin-top: 4px; }
  .footer {
    margin-top: 2.4em;
    padding-top: 1em;
    border-top: 1px solid var(--border);
    font-size: 10pt;
    color: var(--muted);
    display: flex; justify-content: space-between; gap: 16px;
  }
  .footer .contact strong { color: var(--fg); font-weight: 500; }
  .intro { font-size: 12pt; max-width: 56ch; }
  .md-body h1, .md-body h2, .md-body h3 { font-family: var(--font-display); }
  .md-body table { margin: 10px 0 18px; }
  .md-body table th, .md-body table td { padding: 6px 0; font-size: 10.5pt; }
  .md-body hr { border: 0; border-top: 1px solid var(--border); margin: 1em 0; }
  .md-body .signatures { margin-top: 2em; }
  .md-body .signatures .line { display: inline-block; border-bottom: 1px solid var(--fg); width: 240px; }
</style>
</head>
<body>
<div class="brand-header no-break">
  <div>
    ${brand.logo_url
      ? `<img src="${escapeHtml(brand.logo_url)}" alt="${escapeHtml(brand.wordmark_text ?? builder.name)}" />`
      : `<div class="wordmark">${escapeHtml(brand.wordmark_text ?? builder.name)}</div>`}
    ${brand.tagline ? `<div class="brand-tagline">${escapeHtml(brand.tagline)}</div>` : ''}
  </div>
  <div class="small muted" style="text-align:right">
    ${escapeHtml(builder.legal_name ?? builder.name)}
  </div>
</div>

${body}

<div class="footer">
  <div class="contact">
    <div><strong>${escapeHtml(operator.name ?? 'Humble House')}</strong></div>
    <div>${contactLine || ''}</div>
  </div>
  <div style="text-align:right">
    © ${new Date().getFullYear()} ${escapeHtml(builder.legal_name ?? builder.name)}
  </div>
</div>
</body>
</html>`
}

// ──────────────────────────────────────────────────────────────────────
// Quote template (brochure layout)
// ──────────────────────────────────────────────────────────────────────

export function renderQuoteHtml(input: QuoteTemplateInput): string {
  const currency = input.terms.currency
  const validUntil = new Date(new Date(input.created_at).getTime() + (input.terms.quote_validity_days ?? 30) * 86400_000)
    .toISOString().slice(0, 10)

  const scheduleRows = [
    `<tr>
      <td>Reservation deposit</td>
      <td class="muted small">Immediate</td>
      <td class="price">${money(input.terms.reservation_cents, currency)}</td>
    </tr>`,
    ...(input.terms.payment_schedule ?? []).map(step => {
      const dollars = Math.round(input.price_cents * (step.percent / 100))
      return `<tr>
        <td>${escapeHtml(step.label)}</td>
        <td class="muted small">${escapeHtml(step.trigger)}</td>
        <td class="price">${step.percent}% · ${money(dollars, currency)}</td>
      </tr>`
    }),
  ].join('')

  const optionsByGroup = new Map<string, OptionLine[]>()
  for (const o of input.options) {
    if (!optionsByGroup.has(o.group_name)) optionsByGroup.set(o.group_name, [])
    optionsByGroup.get(o.group_name)!.push(o)
  }

  const specGroups = Array.from(optionsByGroup.entries()).map(([group, items]) => `
    <div class="section no-break">
      <h3>${escapeHtml(group)}</h3>
      <table>
        <tbody>
          ${items.map(o => `
            <tr>
              <td>
                <div class="option-row">
                  ${o.swatch_image_url
                    ? `<img class="swatch" src="${escapeHtml(o.swatch_image_url)}" alt="" />`
                    : `<div class="swatch"></div>`}
                  <div>
                    <div>${escapeHtml(o.name)}</div>
                    ${o.code ? `<div class="small muted">${escapeHtml(o.code)}</div>` : ''}
                  </div>
                </div>
              </td>
              <td class="price muted small">
                ${o.included
                  ? 'Included'
                  : o.price_cents_at_selection > 0
                    ? `+ ${money(o.price_cents_at_selection, currency)}`
                    : 'Included'}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `).join('')

  const processGrid = (input.brand.process_copy ?? []).map((s, i) => `
    <div class="process-step">
      <div class="n">${String(i + 1).padStart(2, '0')}</div>
      <div class="label">${escapeHtml(s.label)}</div>
      <div class="copy">${escapeHtml(s.copy)}</div>
    </div>
  `).join('')

  const customerName = input.customer?.full_name ?? input.customer?.email ?? 'Prospective owner'

  const body = `
<section class="cover no-break">
  <div class="hero" ${input.platform.hero_image_url ? `style="background-image:url('${escapeHtml(input.platform.hero_image_url)}')"` : ''}></div>
  <div class="meta">
    <div class="small muted" style="letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px">Quote v${input.version}</div>
    <h1>Prepared for ${escapeHtml(customerName)}</h1>
    <p class="muted">${escapeHtml(input.platform.name)} · ${escapeHtml(input.platform.chassis)} · ${escapeHtml(input.platform.years)}</p>
    <div class="row">
      <div>
        <div class="label">Tier</div>
        <div>${escapeHtml(input.tier.name)}</div>
      </div>
      <div>
        <div class="label">Total</div>
        <div class="accent" style="font-family:var(--font-display);font-size:16pt">${money(input.price_cents, currency)}</div>
      </div>
      <div>
        <div class="label">Valid until</div>
        <div>${validUntil}</div>
      </div>
      ${input.terms.lead_time_copy ? `
        <div>
          <div class="label">Lead time</div>
          <div>${escapeHtml(input.terms.lead_time_copy)}</div>
        </div>` : ''}
    </div>
  </div>
</section>

${input.terms.quote_intro_copy ? `
<section class="section no-break">
  <p class="intro">${escapeHtml(input.terms.quote_intro_copy)}</p>
</section>` : ''}

<section class="section">
  <h2>Specification</h2>
  ${specGroups || '<p class="muted">No options selected.</p>'}
</section>

<div class="page-break"></div>

<section class="section no-break">
  <h2>Pricing &amp; payment schedule</h2>
  <table>
    <thead>
      <tr><th>Step</th><th>Trigger</th><th class="price">Amount</th></tr>
    </thead>
    <tbody>
      ${scheduleRows}
    </tbody>
  </table>
  <div class="total-strip">
    <div>
      <div class="total-label">Build total</div>
      <div class="small muted">After reservation deposit, scheduled payments total 100% of this amount.</div>
    </div>
    <div class="total-value">${money(input.price_cents, currency)}</div>
  </div>
</section>

${input.terms.warranty_text ? `
<section class="section no-break">
  <h3>Warranty</h3>
  <p class="muted">${escapeHtml(input.terms.warranty_text)}</p>
</section>` : ''}

<div class="page-break"></div>

<section class="section">
  <h2>Process</h2>
  <div class="process-grid">
    ${processGrid}
  </div>
</section>
`

  return pageChrome(input.brand, body, input.operator_contact, input.builder)
}

// ──────────────────────────────────────────────────────────────────────
// Contract template
//
// The contract body is Markdown stored on contract_templates; merge
// fields are substituted before this is called. We convert that
// markdown to HTML and wrap it in the same brand chrome so the output
// matches the quote in look-and-feel.
// ──────────────────────────────────────────────────────────────────────

export function markdownToSafeHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0

  const flushParagraph = (buf: string[]) => {
    if (buf.length === 0) return
    const text = buf.join(' ').trim()
    if (!text) return
    out.push(`<p>${inline(text)}</p>`)
  }

  const inline = (s: string): string =>
    escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')

  while (i < lines.length) {
    const raw = lines[i]
    const line = raw.trimEnd()
    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(line)
    if (headingMatch) {
      const n = headingMatch[1].length
      out.push(`<h${n}>${inline(headingMatch[2])}</h${n}>`)
      i += 1
      continue
    }
    if (line.startsWith('|')) {
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = lines[i].split('|').slice(1, -1).map(c => c.trim())
        rows.push(cells)
        i += 1
      }
      if (rows.length < 2) continue
      const [header, _sep, ...body] = rows
      const thead = `<thead><tr>${header.map(h => `<th>${inline(h)}</th>`).join('')}</tr></thead>`
      const tbody = `<tbody>${body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`
      out.push(`<table>${thead}${tbody}</table>`)
      continue
    }
    if (/^\s*$/.test(line)) {
      i += 1
      continue
    }
    if (/^-\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^-\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^-\s+/, ''))}</li>`)
        i += 1
      }
      out.push(`<ul>${items.join('')}</ul>`)
      continue
    }
    // Collect paragraph until blank
    const buf: string[] = []
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,3})\s+/.test(lines[i]) && !lines[i].trim().startsWith('|')) {
      buf.push(lines[i])
      i += 1
    }
    flushParagraph(buf)
  }

  return out.join('\n')
}

export function renderContractHtml(input: ContractTemplateInput): string {
  const body = `
<section class="section">
  <div class="small muted" style="letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px">${escapeHtml(input.title)} · v${input.version}</div>
  <div class="md-body">
    ${input.body_html}
  </div>
</section>
`
  return pageChrome(input.brand, body, input.operator_contact, input.builder)
}
