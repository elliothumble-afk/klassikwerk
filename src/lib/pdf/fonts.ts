import { Font } from '@react-pdf/renderer'

// Each builder brand picks a `font_display` and `font_body` by family
// name. For client-side @react-pdf rendering we need actual TTF files
// (woff/woff2 aren't supported), so we ship a small bundle of
// pre-vetted families under `public/fonts/`. Anything not bundled
// falls back to the built-in Helvetica so a builder with a custom
// font name still produces a readable PDF.

interface FontFile {
  src: string
  fontWeight: 'normal' | 'medium' | 'semibold'
}

const FONT_BUNDLE: Record<string, FontFile[]> = {
  Fraunces: [
    { src: '/fonts/Fraunces-Regular.ttf',  fontWeight: 'normal' },
    { src: '/fonts/Fraunces-Medium.ttf',   fontWeight: 'medium' },
    { src: '/fonts/Fraunces-SemiBold.ttf', fontWeight: 'semibold' },
  ],
  Inter: [
    { src: '/fonts/Inter-Regular.ttf',  fontWeight: 'normal' },
    { src: '/fonts/Inter-Medium.ttf',   fontWeight: 'medium' },
    { src: '/fonts/Inter-SemiBold.ttf',  fontWeight: 'semibold' },
  ],
  // Variable TTFs cover the full weight range in a single file.
  'Cormorant Garamond': [
    { src: '/fonts/CormorantGaramond-VF.ttf', fontWeight: 'normal' },
    { src: '/fonts/CormorantGaramond-VF.ttf', fontWeight: 'medium' },
    { src: '/fonts/CormorantGaramond-VF.ttf', fontWeight: 'semibold' },
  ],
  'DM Sans': [
    { src: '/fonts/DMSans-VF.ttf', fontWeight: 'normal' },
    { src: '/fonts/DMSans-VF.ttf', fontWeight: 'medium' },
    { src: '/fonts/DMSans-VF.ttf', fontWeight: 'semibold' },
  ],
}

const registered = new Set<string>()

function toAbsolute(src: string): string {
  if (typeof window === 'undefined') return src
  return new URL(src, window.location.origin).toString()
}

function registerFamily(family: string) {
  if (registered.has(family)) return
  const files = FONT_BUNDLE[family]
  if (!files) {
    registered.add(family) // mark attempted so we don't retry
    return
  }
  Font.register({
    family,
    fonts: files.map(f => ({ src: toAbsolute(f.src), fontWeight: f.fontWeight })),
  })
  registered.add(family)
}

/**
 * Resolve a brand font family to one @react-pdf can render.
 * Returns the brand's family when it's in the bundle, otherwise
 * `Helvetica` (built in to pdf-lib) as a safe fallback.
 */
export function resolveFamily(family: string): string {
  return family in FONT_BUNDLE ? family : 'Helvetica'
}

/**
 * Register the brand's display + body fonts if they're bundled.
 * Call before `pdf(...).toBlob()`.
 */
export function registerBrandFonts(display: string, body: string) {
  registerFamily(display)
  registerFamily(body)
  Font.registerHyphenationCallback(word => [word])
}
