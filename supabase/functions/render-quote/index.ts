// render-quote — Supabase Edge Function (Deno)
//
// Renders a builder-branded quote PDF: cover, customer details, configuration
// table with option codes, price breakdown, validity date, payment schedule
// from builder_terms, intro copy, HH contact block. Uploads to the `media`
// bucket and writes back `quotes.pdf_url`.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.3'
import { corsHeaders } from '../_shared/cors.ts'
import { renderMarkdownPdf } from '../_shared/pdfRender.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const HH_SIGNATURE = Deno.env.get('HH_SIGNATURE') ?? 'Humble House\nelliot.humble@gmail.com'

function money(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const { quote_id } = await req.json()
    if (!quote_id) throw new Error('quote_id is required')

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

    const quoteRes = await admin
      .from('quotes')
      .select('*, lead:leads(customer:customers(full_name, email, phone))')
      .eq('id', quote_id)
      .single()
    if (quoteRes.error) throw quoteRes.error
    const quote = quoteRes.data as any

    const [builderRes, brandRes, termsRes, platformRes, tierRes, qoRes] = await Promise.all([
      admin.from('builders').select('*').eq('id', quote.builder_id).single(),
      admin.from('builder_brand').select('*').eq('builder_id', quote.builder_id).maybeSingle(),
      admin.from('builder_terms').select('*').eq('builder_id', quote.builder_id).maybeSingle(),
      admin.from('catalog_platforms').select('*').eq('id', quote.platform_id).single(),
      admin.from('catalog_tiers').select('*').eq('id', quote.tier_id).single(),
      admin.from('quote_options').select('option_id, price_cents_at_selection').eq('quote_id', quote.id),
    ])
    if (builderRes.error) throw builderRes.error
    if (platformRes.error) throw platformRes.error
    if (tierRes.error) throw tierRes.error
    if (qoRes.error) throw qoRes.error

    const builder = builderRes.data as any
    const brand = brandRes.data as any | null
    const terms = termsRes.data as any | null
    const platform = platformRes.data as any
    const tier = tierRes.data as any
    const qoRows = qoRes.data as any[]

    const optionIds = qoRows.map(o => o.option_id)
    const optionsRes = optionIds.length
      ? await admin.from('catalog_options').select('id, name, code, group_id').in('id', optionIds)
      : { data: [], error: null }
    if (optionsRes.error) throw optionsRes.error
    const groupIds = Array.from(new Set((optionsRes.data ?? []).map((o: any) => o.group_id)))
    const groupsRes = groupIds.length
      ? await admin.from('catalog_option_groups').select('id, name').in('id', groupIds)
      : { data: [], error: null }
    if (groupsRes.error) throw groupsRes.error
    const groupName = new Map<string, string>((groupsRes.data ?? []).map((g: any) => [g.id, g.name]))
    const priceByOption = new Map<string, number>(qoRows.map(r => [r.option_id, r.price_cents_at_selection]))
    const configRows = (optionsRes.data ?? []).map((o: any) =>
      `| ${groupName.get(o.group_id) ?? 'Option'} | ${o.name}${o.code ? ` (${o.code})` : ''} | ${(priceByOption.get(o.id) ?? 0) > 0 ? money(priceByOption.get(o.id) ?? 0, terms?.currency) : 'Included'} |`
    )
    const configTable = ['| Group | Choice | Price |', '| --- | --- | --- |',
      `| Tier | ${tier.name} | ${tier.base_price_cents != null ? money(tier.base_price_cents, terms?.currency) : '—'} |`,
      ...configRows,
    ].join('\n')

    const scheduleRows = (terms?.payment_schedule ?? []).map((p: any) =>
      `| ${p.label} | ${p.percent}% | ${p.trigger} |`
    )
    const scheduleTable = ['| Step | Share | Trigger |', '| --- | --- | --- |', ...scheduleRows].join('\n')

    const validityDays = terms?.quote_validity_days ?? 30
    const validUntil = new Date(Date.now() + validityDays * 86400_000)
      .toISOString().slice(0, 10)

    const customer = quote.lead?.customer

    const body = `
${brand?.wordmark_text ? `**${brand.wordmark_text}**` : `**${builder.name}**`}
${brand?.tagline ? brand.tagline : ''}

# Quote v${quote.version}

**Prepared for:** ${customer?.full_name ?? customer?.email ?? '[customer]'}
${customer?.email ? `**Email:** ${customer.email}` : ''}
${customer?.phone ? `**Phone:** ${customer.phone}` : ''}

**Valid until:** ${validUntil}

## Vehicle

- Platform: ${platform.name}
- Chassis / Years: ${platform.chassis} · ${platform.years}

${terms?.quote_intro_copy ? `\n${terms.quote_intro_copy}\n` : ''}

## Configuration

${configTable}

## Total

**${money(quote.price_cents, terms?.currency)}**

## Payment schedule

${scheduleTable}

## Warranty

${terms?.warranty_text ?? ''}

## Contact

${HH_SIGNATURE}
`

    const pdfBytes = await renderMarkdownPdf(`${builder.name} — Quote v${quote.version}`, body)

    const path = `document/quote_${quote.id}_v${quote.version}_${Date.now()}.pdf`
    const upload = await admin.storage.from('media').upload(path, pdfBytes, {
      contentType: 'application/pdf',
      upsert: true,
    })
    if (upload.error) throw upload.error

    const { data: pub } = admin.storage.from('media').getPublicUrl(path)
    await admin.from('quotes').update({ pdf_url: pub.publicUrl }).eq('id', quote.id)

    return new Response(JSON.stringify({ url: pub.publicUrl, path }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
