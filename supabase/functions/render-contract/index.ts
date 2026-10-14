// render-contract — Supabase Edge Function (Deno)
//
// Builds a branded HTML contract from the builder's current
// contract_templates row (markdown + merge fields), converts to PDF via
// Browserless, uploads to the `media` bucket, and records a `media` row.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.3'
import { corsHeaders } from '../_shared/cors.ts'
import { htmlToPdf } from '../_shared/htmlToPdf.ts'
import { markdownToSafeHtml, renderContractHtml, type OperatorContact } from '../_shared/htmlTemplate.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function money(cents: number | null | undefined): string {
  if (cents == null) return '$—'
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function mergeFields(markdown: string, fields: Record<string, string>): string {
  return markdown.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => fields[k] ?? `[${k}]`)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const { build_id } = await req.json()
    if (!build_id) throw new Error('build_id is required')

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

    const buildRes = await admin
      .from('builds')
      .select('id, builder_id, platform_id, tier_id, customer_id, vehicle_id, price_cents')
      .eq('id', build_id)
      .single()
    if (buildRes.error) throw buildRes.error
    const build = buildRes.data as any

    const [tplRes, termsRes, builderRes, brandRes, platformRes, tierRes, buildOptsRes] = await Promise.all([
      admin.from('contract_templates').select('*').eq('builder_id', build.builder_id).eq('is_current', true).single(),
      admin.from('builder_terms').select('*').eq('builder_id', build.builder_id).maybeSingle(),
      admin.from('builders').select('*, operator:operators(contact)').eq('id', build.builder_id).single(),
      admin.from('builder_brand').select('*').eq('builder_id', build.builder_id).maybeSingle(),
      admin.from('catalog_platforms').select('*').eq('id', build.platform_id).single(),
      admin.from('catalog_tiers').select('*').eq('id', build.tier_id).single(),
      admin.from('build_options').select('option_id, price_cents_at_selection').eq('build_id', build.id),
    ])
    if (tplRes.error) throw tplRes.error
    if (builderRes.error) throw builderRes.error
    if (brandRes.error) throw brandRes.error
    if (platformRes.error) throw platformRes.error
    if (tierRes.error) throw tierRes.error
    if (buildOptsRes.error) throw buildOptsRes.error

    const buildOpts = buildOptsRes.data ?? []
    const optionIds = buildOpts.map((bo: any) => bo.option_id as string)
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

    let customer: any = null
    let profile: any = null
    if (build.customer_id) {
      const cr = await admin.from('customers').select('*, profiles(*)').eq('id', build.customer_id).maybeSingle()
      if (cr.data) { customer = cr.data; profile = (cr.data as any).profiles }
    }
    let vehicle: any = null
    if (build.vehicle_id) {
      const vr = await admin.from('vehicles').select('*').eq('id', build.vehicle_id).maybeSingle()
      vehicle = vr.data
    }

    const terms = termsRes.data as any | null
    const builderRow = builderRes.data as any
    const brand = brandRes.data as any
    const platform = platformRes.data as any
    const operatorContact = (builderRow.operator?.contact ?? {}) as OperatorContact

    const configRows = (optionsRes.data ?? []).map((o: any) => {
      const grp = groupName.get(o.group_id) ?? 'Option'
      return `| ${grp} | ${o.name}${o.code ? ` (${o.code})` : ''} |`
    })
    const configurationTable = ['| Group | Choice |', '| --- | --- |', ...configRows].join('\n')

    const scheduleRows = (terms?.payment_schedule ?? []).map((p: any) =>
      `| ${p.label} | ${p.percent}% | ${p.trigger} |`
    )
    const paymentScheduleTable = ['| Step | Share | Trigger |', '| --- | --- | --- |', ...scheduleRows].join('\n')

    const fields: Record<string, string> = {
      builder_name: builderRow.name,
      builder_legal_name: builderRow.legal_name ?? builderRow.name,
      customer_full_name: profile?.full_name ?? customer?.full_name ?? customer?.email ?? '[customer]',
      customer_address: customer?.address ? JSON.stringify(customer.address) : '[address]',
      vehicle_platform: platform.name,
      vehicle_vin: vehicle?.vin ?? '[VIN]',
      vehicle_year: vehicle?.year?.toString() ?? '[year]',
      configuration_table: configurationTable,
      price_total: money(build.price_cents),
      payment_schedule_table: paymentScheduleTable,
      warranty_text: terms?.warranty_text ?? '',
      governing_law: terms?.governing_law ?? '',
    }

    const mergedMd = mergeFields((tplRes.data as any).body_markdown, fields)
    const bodyHtml = markdownToSafeHtml(mergedMd)

    const html = renderContractHtml({
      title: (tplRes.data as any).title,
      version: (tplRes.data as any).version,
      body_html: bodyHtml,
      builder: { name: builderRow.name, legal_name: builderRow.legal_name, slug: builderRow.slug },
      brand,
      operator_contact: operatorContact,
    })

    const pdfBytes = await htmlToPdf(html)

    const path = `document/contract_${build.id}_v${(tplRes.data as any).version}_${Date.now()}.pdf`
    const upload = await admin.storage.from('media').upload(path, pdfBytes, {
      contentType: 'application/pdf',
      upsert: true,
    })
    if (upload.error) throw upload.error

    await admin.from('media').insert({
      build_id: build.id,
      storage_path: path,
      kind: 'document',
      caption: `${(tplRes.data as any).title} v${(tplRes.data as any).version}`,
    })

    const { data: pub } = admin.storage.from('media').getPublicUrl(path)

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
