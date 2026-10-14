// render-quote — Supabase Edge Function (Deno)
//
// Builds a branded, brochure-style HTML quote and converts it to PDF via
// Browserless (hosted headless Chrome). Writes the PDF to the `media`
// bucket, updates quotes.pdf_url, returns the public URL.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.3'
import { corsHeaders } from '../_shared/cors.ts'
import { htmlToPdf } from '../_shared/htmlToPdf.ts'
import { renderQuoteHtml, type OptionLine, type OperatorContact } from '../_shared/htmlTemplate.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const { quote_id } = await req.json()
    if (!quote_id) throw new Error('quote_id is required')

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

    const quoteRes = await admin
      .from('quotes')
      .select('*, lead:leads(phone, customer:customers(full_name, email))')
      .eq('id', quote_id)
      .single()
    if (quoteRes.error) throw quoteRes.error
    const quote = quoteRes.data as any

    const [builderRes, brandRes, termsRes, platformRes, tierRes, qoRes] = await Promise.all([
      admin.from('builders').select('*, operator:operators(contact)').eq('id', quote.builder_id).single(),
      admin.from('builder_brand').select('*').eq('builder_id', quote.builder_id).maybeSingle(),
      admin.from('builder_terms').select('*').eq('builder_id', quote.builder_id).maybeSingle(),
      admin.from('catalog_platforms').select('*').eq('id', quote.platform_id).single(),
      admin.from('catalog_tiers').select('*').eq('id', quote.tier_id).single(),
      admin.from('quote_options').select('option_id, price_cents_at_selection').eq('quote_id', quote.id),
    ])
    if (builderRes.error) throw builderRes.error
    if (brandRes.error) throw brandRes.error
    if (termsRes.error) throw termsRes.error
    if (platformRes.error) throw platformRes.error
    if (tierRes.error) throw tierRes.error
    if (qoRes.error) throw qoRes.error

    const builderRow = builderRes.data as any
    const operatorContact = (builderRow.operator?.contact ?? {}) as OperatorContact
    const brand = brandRes.data as any
    const terms = termsRes.data as any
    const platform = platformRes.data as any
    const tier = tierRes.data as any
    const qoRows = qoRes.data as any[]

    const optionIds = qoRows.map(o => o.option_id)
    const optionsRes = optionIds.length
      ? await admin.from('catalog_options').select('id, name, code, group_id, swatch_image_url, included_in_tier_ids').in('id', optionIds)
      : { data: [], error: null }
    if (optionsRes.error) throw optionsRes.error
    const groupIds = Array.from(new Set((optionsRes.data ?? []).map((o: any) => o.group_id)))
    const groupsRes = groupIds.length
      ? await admin.from('catalog_option_groups').select('id, name, sort').in('id', groupIds).order('sort')
      : { data: [], error: null }
    if (groupsRes.error) throw groupsRes.error
    const groupById = new Map<string, { name: string; sort: number }>(
      (groupsRes.data ?? []).map((g: any) => [g.id, { name: g.name, sort: g.sort }])
    )
    const priceByOption = new Map<string, number>(qoRows.map(r => [r.option_id, r.price_cents_at_selection]))

    const options: OptionLine[] = (optionsRes.data ?? [])
      .map((o: any) => ({
        group_name: groupById.get(o.group_id)?.name ?? 'Option',
        group_sort: groupById.get(o.group_id)?.sort ?? 0,
        name: o.name,
        code: o.code,
        swatch_image_url: o.swatch_image_url,
        price_cents_at_selection: priceByOption.get(o.id) ?? 0,
        included: (o.included_in_tier_ids ?? []).includes(quote.tier_id),
      }))
      .sort((a, b) => a.group_sort - b.group_sort)
      .map(({ group_sort: _s, ...rest }) => rest)

    const html = renderQuoteHtml({
      version: quote.version,
      price_cents: quote.price_cents,
      created_at: quote.created_at,
      builder: { name: builderRow.name, legal_name: builderRow.legal_name, slug: builderRow.slug },
      brand,
      terms,
      operator_contact: operatorContact,
      platform,
      tier,
      options,
      customer: quote.lead?.customer ?? null,
      customer_phone: quote.lead?.phone ?? null,
    })

    const pdfBytes = await htmlToPdf(html)

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
