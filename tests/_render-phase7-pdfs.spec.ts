// One-off: render the build sheet + PO PDF for the Phase 7 build so
// we can preview them locally and attach to the PR. Reads
// KW_BUILD_ID from the environment.

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

test('render Phase 7 build sheet + first PO PDF', async ({ page }) => {
  test.setTimeout(120_000)
  const buildId = env('KW_BUILD_ID')

  const sess = await session()
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, value)
  }, { key: `sb-${PROJECT_REF}-auth-token`, value: JSON.stringify(sess) })

  page.on('pageerror', e => console.log('[pageerror]', e.message))
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[browser]', m.type(), m.text()) })

  await page.goto(`/ops/builds/${buildId}`)

  // Build sheet: click Generate build sheet, wait for a new Documents row.
  const documentsSection = page.locator('section', { hasText: 'Documents' })
  await page.getByRole('button', { name: /Generate build sheet/ }).click()
  await documentsSection.getByRole('link', { name: /Open PDF/ }).first().waitFor({ timeout: 60_000 })
  const buildSheetUrl = await documentsSection.getByRole('link', { name: /Open PDF/ }).first().getAttribute('href')
  console.log('[phase7] build sheet URL:', buildSheetUrl)
  if (buildSheetUrl) {
    const bsResp = await page.request.get(buildSheetUrl)
    fs.writeFileSync('/tmp/phase7-build-sheet.pdf', Buffer.from(await bsResp.body()))
    fs.writeFileSync('/tmp/phase7-build-sheet-url.txt', buildSheetUrl)
  }

  // PO: click Regenerate PDF on the first PO row (inside the Orders section)
  const ordersSection = page.locator('section', { hasText: 'Orders' })
  await ordersSection.getByRole('button', { name: /Regenerate PDF/ }).first().click()
  await ordersSection.getByRole('link', { name: /^Open PDF$/ }).first().waitFor({ timeout: 60_000 })
  const poUrl = await ordersSection.getByRole('link', { name: /^Open PDF$/ }).first().getAttribute('href')
  console.log('[phase7] PO PDF URL:', poUrl)
  if (poUrl) {
    const poResp = await page.request.get(poUrl)
    fs.writeFileSync('/tmp/phase7-po.pdf', Buffer.from(await poResp.body()))
    fs.writeFileSync('/tmp/phase7-po-url.txt', poUrl)
  }
})
