// Shared Zoho helpers: token refresh (cached), base URL, module calls.
// deno-lint-ignore-file no-explicit-any
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.50.3'

const CLIENT_ID = Deno.env.get('ZOHO_CLIENT_ID')
const CLIENT_SECRET = Deno.env.get('ZOHO_CLIENT_SECRET')
const REFRESH_TOKEN = Deno.env.get('ZOHO_REFRESH_TOKEN')
const DC = Deno.env.get('ZOHO_DC') ?? 'us'

export function zohoConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN)
}

export function accountsHost(): string {
  return `https://accounts.zoho.${DC === 'us' ? 'com' : DC}`
}
export function apiHost(): string {
  return `https://www.zohoapis.${DC === 'us' ? 'com' : DC}`
}

/**
 * Return a non-expired access token, refreshing from Zoho if the cached
 * row in `zoho_tokens` is missing or close to expiry.
 */
export async function getAccessToken(admin: SupabaseClient): Promise<string> {
  if (!zohoConfigured()) throw new Error('Zoho secrets are not configured')

  const row = await admin.from('zoho_tokens').select('*').eq('id', 1).maybeSingle()
  if (row.error) throw row.error
  if (row.data && new Date(row.data.expires_at).getTime() - Date.now() > 60_000) {
    return row.data.access_token
  }

  const r = await fetch(`${accountsHost()}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: REFRESH_TOKEN!,
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      grant_type: 'refresh_token',
    }),
  })
  const body = await r.json()
  if (!r.ok || !body?.access_token) throw new Error(body?.error ?? 'Zoho token refresh failed')
  const expiresAt = new Date(Date.now() + (body.expires_in ?? 3600) * 1000).toISOString()
  await admin.from('zoho_tokens').upsert({ id: 1, access_token: body.access_token, expires_at: expiresAt })
  return body.access_token as string
}

export async function logSync(admin: SupabaseClient, row: {
  direction: 'inbound' | 'outbound',
  object: string,
  object_id?: string | null,
  payload: unknown,
  status: 'success' | 'error' | 'pending',
  error?: string | null,
}) {
  await admin.from('zoho_sync_log').insert({
    direction: row.direction,
    object: row.object,
    object_id: row.object_id ?? null,
    payload: row.payload as any,
    status: row.status,
    error: row.error ?? null,
  })
}

export function makeAdmin(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}
