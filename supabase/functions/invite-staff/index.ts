// invite-staff — Supabase Edge Function (Deno)
//
// Admin-only. Invites a staff member by email (Supabase sends the
// invite email), then upserts the public.profiles row with the
// chosen role and full_name. UI labels map to DB roles:
//   admin → operator,  rep → ops.
//
// Pre-existing users: if the email already resolves to an auth user,
// return 409 with `{ error: 'User already exists' }` and change
// nothing. The admin UI should route an existing user through the
// edit controls on the Users page instead.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.3'
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = (Deno.env.get('HH_SERVICE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!

interface Body {
  email: string
  full_name: string
  role: 'admin' | 'rep'
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Scans auth.users via listUsers (paged) and returns the user with
// the matching email, or null. Case-insensitive.
async function findAuthUserByEmail(admin: any, email: string): Promise<{ id: string; email: string } | null> {
  const target = email.toLowerCase()
  const pageSize = 1000
  for (let page = 1; page <= 20; page++) {
    const r = await admin.auth.admin.listUsers({ page, perPage: pageSize })
    if (r.error) throw r.error
    const hit = r.data.users.find((u: any) => u.email?.toLowerCase() === target)
    if (hit) return { id: hit.id, email: hit.email }
    if (r.data.users.length < pageSize) break
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  try {
    // Caller must be an operator.
    const auth = req.headers.get('Authorization') ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!token) return json(401, { error: 'no token' })
    const userRes = await admin.auth.getUser(token)
    if (userRes.error || !userRes.data.user) return json(401, { error: 'bad token' })
    const callerId = userRes.data.user.id
    const callerProfile = await admin.from('profiles')
      .select('role').eq('user_id', callerId).maybeSingle()
    if (callerProfile.data?.role !== 'operator') {
      return json(403, { error: 'operator role required' })
    }

    const body = await req.json() as Body
    const { email, full_name, role } = body
    if (!email || !full_name || !role) {
      return json(400, { error: 'email, full_name, role required' })
    }
    const dbRole = role === 'admin' ? 'operator' : 'ops'

    // Pre-flight: existence check before we touch anything. We
    // intentionally do NOT fall back to "update the existing profile"
    // here — overwriting the operator's own name/role was the whole
    // point of the bug we're fixing. If the email already has an auth
    // user OR a profile linked to that auth user, 409.
    const existingAuth = await findAuthUserByEmail(admin, email)
    if (existingAuth) {
      return json(409, { error: 'User already exists' })
    }
    // Belt-and-braces: a profile could in theory exist without an
    // auth user (service-role inserts); treat the email-row collision
    // the same way.
    const existingProfile = await admin.from('staff_profiles')
      .select('id').ilike('email', email).maybeSingle()
    if (existingProfile.data?.id) {
      return json(409, { error: 'User already exists' })
    }

    // inviteUserByEmail creates the auth user and sends the Supabase
    // invite email. The handle_new_user trigger auto-inserts a
    // profiles row with role='customer' — we specialise it below.
    const invite = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name },
    })
    if (invite.error) throw invite.error
    const newId = invite.data.user?.id
    if (!newId) throw new Error('invite did not return a user id')

    const upd = await admin.from('profiles').update({
      full_name,
      role: dbRole,
      active: true,
      updated_at: new Date().toISOString(),
    } as never).eq('user_id', newId)
    if (upd.error) throw upd.error

    return json(200, { ok: true, user_id: newId })
  } catch (e) {
    return json(500, { error: (e as Error).message })
  }
})
