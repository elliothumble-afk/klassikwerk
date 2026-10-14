// htmlToPdf — convert an HTML document to a PDF using Browserless.
//
// Headless-Chrome HTML → PDF isn't practical to bundle inside a Supabase
// Edge Function (Deno has no Puppeteer and shipping Chromium bytes
// exceeds the function size budget). We call out to Browserless, which
// gives us real Chrome rendering with web fonts, images, CSS and page
// breaks. Set BROWSERLESS_TOKEN as a secret in the project.
//
// If the token is missing we throw a clear error so the UI's error
// surfacing shows exactly what to fix.

const BROWSERLESS_TOKEN = Deno.env.get('BROWSERLESS_TOKEN')
const BROWSERLESS_URL = Deno.env.get('BROWSERLESS_URL') ?? 'https://chrome.browserless.io'

export interface PdfOptions {
  format?: 'A4' | 'Letter'
  marginTop?: string
  marginBottom?: string
  marginLeft?: string
  marginRight?: string
}

export async function htmlToPdf(html: string, options: PdfOptions = {}): Promise<Uint8Array> {
  if (!BROWSERLESS_TOKEN) {
    throw new Error('BROWSERLESS_TOKEN is not set — HTML→PDF conversion is unavailable. Set the secret with `supabase secrets set BROWSERLESS_TOKEN=...`.')
  }
  const r = await fetch(`${BROWSERLESS_URL}/pdf?token=${BROWSERLESS_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      html,
      options: {
        format: options.format ?? 'Letter',
        printBackground: true,
        preferCSSPageSize: true,
        margin: {
          top:    options.marginTop    ?? '0.6in',
          bottom: options.marginBottom ?? '0.6in',
          left:   options.marginLeft   ?? '0.5in',
          right:  options.marginRight  ?? '0.5in',
        },
      },
      gotoOptions: {
        waitUntil: 'networkidle0',
        timeout: 25_000,
      },
    }),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`Browserless responded ${r.status}: ${text.slice(0, 500)}`)
  }
  const buf = new Uint8Array(await r.arrayBuffer())
  return buf
}
