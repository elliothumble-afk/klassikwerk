// Re-render an existing quote through the editor UI and stash the
// resulting PDF locally. Set KW_QUOTE_ID to the target quote.

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

const SUPABASE_URL = 'https://vvuccbskbswtfvxplxxm.supabase.co'
const PROJECT_REF = 'vvuccbskbswtfvxplxxm'
const OPERATOR_EMAIL = 'elliot.humble@gmail.com'

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

async function session() {
  const admin = createClient(SUPABASE_URL, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
  const anon = createClient(SUPABASE_URL, env('VITE_SUPABASE_ANON_KEY'), { auth: { persistSession: false } })
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: OPERATOR_EMAIL })
  if (error) throw error
  const token_hash = (data.properties as { hashed_token: string }).hashed_token
  const verify = await anon.auth.verifyOtp({ token_hash, type: 'magiclink' })
  if (verify.error) throw verify.error
  return verify.data.session!
}

test('Regenerate quote PDF', async ({ page }) => {
  test.setTimeout(180_000)
  const quoteId = process.env.KW_QUOTE_ID
  if (!quoteId) throw new Error('KW_QUOTE_ID is required')
  const outName = process.env.KW_OUT_NAME ?? 'regen'

  const sess = await session()
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, value)
  }, { key: `sb-${PROJECT_REF}-auth-token`, value: JSON.stringify(sess) })

  page.on('console', m => {
    if (m.type() === 'error') console.log('[browser error]', m.text())
  })
  page.on('pageerror', e => console.log('[pageerror]', e.message))

  await page.goto(`/ops/quotes/${quoteId}`)
  await page.getByRole('button', { name: /Generate PDF/ }).click()
  await expect(page.getByText(/PDF ready/)).toBeVisible({ timeout: 120_000 })
  const link = page.getByRole('link', { name: /Open PDF/ })
  const url = await link.getAttribute('href')
  expect(url).toBeTruthy()
  console.log('[regen] url:', url)

  const resp = await page.request.get(url!)
  expect(resp.status()).toBe(200)
  const buf = Buffer.from(await resp.body())
  fs.writeFileSync(`/tmp/${outName}.pdf`, buf)
  fs.writeFileSync(`/tmp/${outName}-url.txt`, url!)
})
