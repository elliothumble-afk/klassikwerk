// create-reservation-checkout — Supabase Edge Function (Deno)
//
// Always creates the reservation (customer → build → build_options →
// build_stage_events). Payment is a per-builder toggle on builder_terms:
//
//   payment_mode = 'none'   → return { build_id, url: null }
//   payment_mode = 'stripe' → create a Stripe Checkout Session for the
//                             reservation deposit, carry build_id in
//                             metadata, return { build_id, url }
//
// Called anonymously from the public configurator with --no-verify-jwt.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.3'
import Stripe from 'https://esm.sh/stripe@17.5.0?target=denonext'
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY')

interface Payload {
  builder_id: string
  builder_slug: string
  platform_id: string
  tier_id: string
  selection: string[]
  email: string
  full_name: string
  origin: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const p = await req.json() as Payload
    if (!p.builder_id) throw new Error('builder_id is required')
    if (!p.platform_id) throw new Error('platform_id is required')
    if (!p.tier_id) throw new Error('tier_id is required')
    if (!p.email) throw new Error('email is required')

    const email = p.email.trim().toLowerCase()
    const fullName = (p.full_name ?? '').trim() || null

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

    // ---------- Terms + tier (for pricing + currency) ----------
    const [termsRes, tierRes, optionsRes] = await Promise.all([
      admin.from('builder_terms').select('*').eq('builder_id', p.builder_id).maybeSingle(),
      admin.from('catalog_tiers').select('*').eq('id', p.tier_id).single(),
      p.selection?.length
        ? admin.from('catalog_options').select('*').in('id', p.selection)
        : Promise.resolve({ data: [], error: null } as any),
    ])
    if (termsRes.error) throw termsRes.error
    if (tierRes.error) throw tierRes.error
    if (optionsRes.error) throw optionsRes.error

    const terms = termsRes.data
    const tier = tierRes.data as any
    const options = (optionsRes.data ?? []) as any[]

    // ---------- Price ----------
    const basePrice = tier.base_price_cents ?? 0
    const addons = options.reduce((sum, o) => {
      const included = (o.included_in_tier_ids ?? []).includes(p.tier_id)
      return included ? sum : sum + (o.price_cents ?? 0)
    }, 0)
    const priceCents = basePrice + addons

    // ---------- Customer upsert by email ----------
    const existing = await admin
      .from('customers')
      .select('*')
      .eq('email', email)
      .maybeSingle()
    if (existing.error) throw existing.error

    let customerId: string
    if (existing.data) {
      customerId = (existing.data as any).id
      if (fullName && !(existing.data as any).full_name) {
        await admin.from('customers').update({ full_name: fullName }).eq('id', customerId)
      }
    } else {
      const insCustomer = await admin
        .from('customers')
        .insert({ email, full_name: fullName, source: 'web' })
        .select('id')
        .single()
      if (insCustomer.error) throw insCustomer.error
      customerId = (insCustomer.data as any).id
    }

    // ---------- Next slot number for (builder, year) ----------
    const slotYear = new Date().getUTCFullYear()
    const maxRes = await admin
      .from('builds')
      .select('slot_number')
      .eq('builder_id', p.builder_id)
      .eq('slot_year', slotYear)
      .order('slot_number', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
    if (maxRes.error && maxRes.error.code !== 'PGRST116') throw maxRes.error
    const slotNumber = ((maxRes.data as any)?.slot_number ?? 0) + 1

    // ---------- Create the build ----------
    const buildIns = await admin
      .from('builds')
      .insert({
        builder_id: p.builder_id,
        customer_id: customerId,
        platform_id: p.platform_id,
        tier_id: p.tier_id,
        stage: 'reserved',
        slot_year: slotYear,
        slot_number: slotNumber,
        price_cents: priceCents,
        payment_status: 'unpaid',
      })
      .select('id')
      .single()
    if (buildIns.error) throw buildIns.error
    const buildId = (buildIns.data as any).id as string

    // ---------- Build options ----------
    if (options.length > 0) {
      const rows = options.map((o) => ({
        build_id: buildId,
        option_id: o.id,
        price_cents_at_selection:
          (o.included_in_tier_ids ?? []).includes(p.tier_id) ? 0 : (o.price_cents ?? 0),
      }))
      const boIns = await admin.from('build_options').insert(rows)
      if (boIns.error) throw boIns.error
    }

    // ---------- Stage event ----------
    await admin.from('build_stage_events').insert({
      build_id: buildId,
      from_stage: null,
      to_stage: 'reserved',
      note: 'Anonymous web reservation',
    })

    // ---------- Payment ----------
    const paymentMode = (terms?.payment_mode as string) ?? 'none'
    if (paymentMode === 'stripe' && STRIPE_KEY) {
      const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2024-11-20.acacia' })
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        line_items: [
          {
            price_data: {
              currency: terms?.currency ?? 'usd',
              unit_amount: terms?.reservation_cents ?? 100000,
              product_data: { name: `Reservation deposit (${p.builder_slug})` },
            },
            quantity: 1,
          },
        ],
        success_url: `${p.origin}/b/${p.builder_slug}/reserve/success?build=${buildId}`,
        cancel_url: `${p.origin}/b/${p.builder_slug}/configure`,
        metadata: {
          build_id: buildId,
          builder_id: p.builder_id,
        },
      })

      await admin.from('builds').update({ payment_status: 'pending' }).eq('id', buildId)

      return new Response(JSON.stringify({ build_id: buildId, url: session.url }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ build_id: buildId, url: null }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
