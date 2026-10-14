// create-reservation-checkout — Supabase Edge Function (Deno)
//
// Creates a Stripe Checkout Session for a builder's reservation deposit.
// Carries `builder_id` metadata so a future webhook can route to the correct
// builder (and, with Connect, the correct `builders.stripe_account_id`).
//
// If STRIPE_SECRET_KEY is not set, returns `{ url: null }` so the preview
// deploy can still render the reservation flow end-to-end.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.3'
import Stripe from 'https://esm.sh/stripe@17.5.0?target=denonext'
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const payload = await req.json()
    const { builder_id, platform_id, tier_id, selection, origin, builder_slug } = payload as {
      builder_id: string
      platform_id: string
      tier_id: string
      selection: string[]
      origin: string
      builder_slug: string
    }
    if (!builder_id) throw new Error('builder_id is required')

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
    const termsRes = await admin
      .from('builder_terms')
      .select('reservation_cents, currency')
      .eq('builder_id', builder_id)
      .maybeSingle()
    if (termsRes.error) throw termsRes.error
    const reservationCents = termsRes.data?.reservation_cents ?? 100000
    const currency = termsRes.data?.currency ?? 'usd'

    if (!STRIPE_KEY) {
      // Preview / dev path: skip Stripe entirely and let the frontend route
      // the user to its demo success page.
      return new Response(JSON.stringify({ url: null, demo: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2024-11-20.acacia' })
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency,
            unit_amount: reservationCents,
            product_data: { name: `Reservation deposit (${builder_slug})` },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/b/${builder_slug}/reserve/success`,
      cancel_url: `${origin}/b/${builder_slug}/configure`,
      metadata: {
        builder_id,
        platform_id,
        tier_id,
        selection: (selection ?? []).join(','),
      },
    })

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
