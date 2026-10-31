// Drives the editor UI (same code the Netlify preview serves) against
// Thomas Humble's existing Defender 110 quote, clicks Generate PDF,
// and stashes the resulting URL + file for the PR comment. No seeding
// — the quote already exists in prod data.

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

const SUPABASE_URL = 'https://vvuccbskbswtfvxplxxm.supabase.co'
const PROJECT_REF = 'vvuccbskbswtfvxplxxm'
const OPERATOR_EMAIL = 'elliot.humble@gmail.com'
const THOMAS_QUOTE_ID = '398f95b7-5175-4961-a36f-528e6892c55f'

function env(k: string): string {
  const dotenv = path.join(process.cwd(), '.env')
  if (!process.env[k] && fs.existsSync(dotenv)) {
    for (const line of fs.readFileSync(dotenv, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  }
  const v = process.env[k]
  if (!v) throw new Error(`${k} is required`)
  return v
}
const ANON = env('VITE_SUPABASE_ANON_KEY')
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY')

async function session() {
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } })
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } })
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: OPERATOR_EMAIL })
  if (error) throw error
  const token_hash = (data.properties as { hashed_token: string }).hashed_token
  const verify = await anon.auth.verifyOtp({ token_hash, type: 'magiclink' })
  if (verify.error) throw verify.error
  return verify.data.session!
}

test('Regenerate Thomas Defender 110 quote PDF', async ({ page }) => {
  test.setTimeout(120_000)
  const sess = await session()
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, value)
  }, { key: `sb-${PROJECT_REF}-auth-token`, value: JSON.stringify(sess) })

  await page.goto(`/ops/quotes/${THOMAS_QUOTE_ID}`)
  await page.getByRole('button', { name: /Generate PDF/ }).click()
  await expect(page.getByText(/PDF ready/)).toBeVisible({ timeout: 60_000 })

  const link = page.getByRole('link', { name: /Open PDF/ })
  const url = await link.getAttribute('href')
  expect(url, 'quote should expose a pdf_url after Generate PDF').toBeTruthy()
  console.log('[thomas] pdf_url:', url)

  const resp = await page.request.get(url!)
  expect(resp.status()).toBe(200)
  const buf = Buffer.from(await resp.body())
  fs.writeFileSync('/tmp/thomas-lookbook.pdf', buf)
  fs.writeFileSync('/tmp/thomas-lookbook-url.txt', url!)
  const pageCount = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
  console.log('[thomas] pages:', pageCount)
  expect(pageCount).toBeGreaterThanOrEqual(10)
})
