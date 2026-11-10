// invite-staff — Supabase Edge Function (Deno)
//
// Admin-only. Invites a staff member by email (Supabase sends the
// invite email), then upserts the public.profiles row with the
// chosen role and full_name. UI labels map to DB roles:
//   admin → operator,  rep → ops.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.3'
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

interface Body {
  email: string
  full_name: string
  role: 'admin' | 'rep'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  try {
    // Caller must be an operator.
    const auth = req.headers.get('Authorization') ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!token) return new Response(JSON.stringify({ error: 'no token' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    const userRes = await admin.auth.getUser(token)
    if (userRes.error || !userRes.data.user) {
      return new Response(JSON.stringify({ error: 'bad token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const callerId = userRes.data.user.id
    const callerProfile = await admin.from('profiles')
      .select('role').eq('user_id', callerId).maybeSingle()
    if (callerProfile.data?.role !== 'operator') {
      return new Response(JSON.stringify({ error: 'operator role required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const body = await req.json() as Body
    const { email, full_name, role } = body
    if (!email || !full_name || !role) {
      return new Response(JSON.stringify({ error: 'email, full_name, role required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const dbRole = role === 'admin' ? 'operator' : 'ops'

    // inviteUserByEmail creates the auth user and sends the Supabase
    // invite email. Our handle_new_user trigger auto-inserts a
    // profiles row with role='customer' — we overwrite it below.
    const invite = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name },
    })
    if (invite.error) {
      // User already exists → still OK to (re)invite via a magic link.
      const msg = invite.error.message?.toLowerCase() ?? ''
      if (!msg.includes('already') && !msg.includes('exists')) {
        throw invite.error
      }
    }

    // Resolve the auth user (whether just-created or pre-existing).
    const list = await admin.auth.admin.listUsers()
    if (list.error) throw list.error
    const user = list.data.users.find(u => u.email?.toLowerCase() === email.toLowerCase())
    if (!user) throw new Error('could not locate newly invited user')

    const upd = await admin.from('profiles').update({
      full_name,
      role: dbRole,
      active: true,
      updated_at: new Date().toISOString(),
    } as never).eq('user_id', user.id)
    if (upd.error) throw upd.error

    return new Response(JSON.stringify({ ok: true, user_id: user.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
