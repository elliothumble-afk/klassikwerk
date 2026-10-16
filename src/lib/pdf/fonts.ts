import { Font } from '@react-pdf/renderer'

// Fonts are fetched from the fontsource CDN at render time. Google Font
// family names map to the fontsource slug (lowercase, hyphenated), e.g.
// "Fraunces" → "fraunces", "Playfair Display" → "playfair-display".
//
// Register-once per family; @react-pdf's Font.register is idempotent per
// family + weight, so calling this on every render is cheap.

function slugify(family: string): string {
  return family.trim().toLowerCase().replace(/\s+/g, '-')
}

function url(slug: string, weight: 400 | 500 | 600): string {
  return `https://cdn.jsdelivr.net/npm/@fontsource/${slug}/files/${slug}-latin-${weight}-normal.ttf`
}

const registered = new Set<string>()

function registerFamily(family: string) {
  if (registered.has(family)) return
  const slug = slugify(family)
  try {
    Font.register({
      family,
      fonts: [
        { src: url(slug, 400), fontWeight: 'normal' },
        { src: url(slug, 500), fontWeight: 'medium' },
        { src: url(slug, 600), fontWeight: 'semibold' },
      ],
    })
    registered.add(family)
  } catch {
    // If registration fails (unknown family on fontsource), @react-pdf
    // will fall back to Helvetica silently.
  }
}

/**
 * Register the brand's display + body fonts for client-side PDF
 * rendering. Safe to call every time before `pdf(...).toBlob()`.
 */
export function registerBrandFonts(display: string, body: string) {
  registerFamily(display)
  registerFamily(body)
  // Disable hyphenation — the default aggressively splits "Mercedes-Benz".
  Font.registerHyphenationCallback(word => [word])
}
