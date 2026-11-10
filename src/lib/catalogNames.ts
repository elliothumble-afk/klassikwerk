// Catalog name hygiene shared by the lookbook PDF and the public /q
// page. Shopify copy arrives in SHOUT-CAPS with vehicle decorations
// and SKU suffixes glued on; both surfaces want the same clean label.
//
// Three kinds of noise this module strips:
//   1. Leading platform prefix — "INEOS Grenadier (2023 Onwards)
//      Comfort Leather Interior (LSCIC24SDWS3N)"
//   2. Trailing platform suffix — "Large Rear Roof Wing for Land Rover
//      Defender (2020 Onwards)" (also "FOR" uppercase)
//   3. Trailing "(SKU)" disambiguator — on either shape.
//
// The pattern we strip isn't just the current quote's platform.name —
// Shopify titles often say "Land Rover Defender" where the catalog
// row is "Land Rover Defender 110", or "INEOS Grenadier" where ours
// is "Ineos Grenadier". So we match any "<Capitalised Words>
// (YYYY+)" shape bounded by the string edge, case-insensitive on the
// "for" / "Onwards" / "Present" keywords.

// A years parenthetical: (2023 Onwards), (1991-2016), (2023–Present),
// (2024 onwards). Match both case variants explicitly so the outer
// regex doesn't need the /i flag — /i would widen [A-Z] to [A-Za-z]
// and let the platform-name alternation eat lower-case words.
const YEARS_PAREN = `\\(\\s*\\d{4}(?:\\s*[-–]\\s*\\d{4}|\\s*(?:[Oo]n\\s*[Ww]ards?|[Pp]resent))?\\s*\\)`
// A platform-name token: 1-7 Capitalised words so "Land Rover Defender
// 110 V8 Petrol" (6 words) survives the match before (years). Allows
// hyphens, slashes, and digits mid-word.
const PLATFORM_NAME = `(?:[A-Z][A-Za-z0-9/-]*(?:\\s+[A-Z0-9][A-Za-z0-9/-]*){0,6})`
// "for" / "fits" — common Shopify suffix connectors. Match both cases
// explicitly, no /i flag on the outer regex.
const FOR_WORD = `(?:[Ff][Oo][Rr]|[Ff][Ii][Tt][Ss]?)`

export function stripVehicleDecorations(name: string, platformNames: string[] = []): string {
  if (!name) return ''
  let out = name.trim()
  const leading = new RegExp(`^\\s*${PLATFORM_NAME}\\s*${YEARS_PAREN}\\s*[-–—:]?\\s*`)
  out = out.replace(leading, '')
  const trailingWithFor = new RegExp(`\\s+${FOR_WORD}\\s+${PLATFORM_NAME}\\s*${YEARS_PAREN}\\s*$`)
  out = out.replace(trailingWithFor, '')
  const trailingAlone = new RegExp(`^${PLATFORM_NAME}\\s*${YEARS_PAREN}\\s*$`)
  out = out.replace(trailingAlone, '')
  if (platformNames.length > 0) {
    const names = [...platformNames].sort((a, b) => b.length - a.length)
    for (const n of names) {
      const pat = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`^\\s*${pat}\\s+(?!$)`, 'i')
      if (re.test(out)) {
        out = out.replace(re, '')
        break
      }
    }
  }
  out = out.replace(/\s*\(\d+\)\s*$/, '')
  return out.trim()
}

// ─── All-caps → Title Case ───────────────────────────────────────
const KEEP_AS_IS = new Set([
  'AMG', 'CTC', 'RS', 'DC', 'LED', 'KO3', 'G22', 'G63', 'G350', 'G400', 'UK',
  'II', 'III', 'IV',
  'LT', 'V8', 'P525', 'P400', 'D300',
])
const MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on',
  'or', 'the', 'to', 'with',
])

function titleCaseSubtoken(w: string): string {
  if (!w) return w
  if (KEEP_AS_IS.has(w)) return w
  const prefixMatch = /^([A-Z]+)(\d+)$/.exec(w)
  if (prefixMatch && KEEP_AS_IS.has(prefixMatch[1])) return w
  if (/^[A-Z0-9]+$/.test(w) && (w.match(/[A-Z]/g)?.length ?? 0) >= 2) {
    return w[0] + w.slice(1).toLowerCase()
  }
  return w
}

function titleCaseToken(token: string): string {
  return token.split(/([-/])/).map(part =>
    /^[-/]$/.test(part) ? part : titleCaseSubtoken(part),
  ).join('')
}

export function titleCaseName(name: string): string {
  if (!name) return ''
  const parts = name.split(/(\s+)/)
  const wordIdx: number[] = []
  parts.forEach((p, i) => { if (!/^\s+$/.test(p)) wordIdx.push(i) })
  const firstWord = wordIdx[0] ?? -1
  const lastWord = wordIdx[wordIdx.length - 1] ?? -1
  return parts.map((p, i) => {
    if (/^\s+$/.test(p)) return p
    const tc = titleCaseToken(p)
    const isEdge = i === firstWord || i === lastWord
    if (!isEdge && MINOR_WORDS.has(tc.toLowerCase())) return tc.toLowerCase()
    return tc
  }).join('')
}

export function stripTrailingSku(name: string, sku: string | null): string {
  if (!name) return ''
  let out = name.trim()
  if (sku) {
    const pat = sku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`\\s*\\(${pat}\\)\\s*$`, 'i'), '')
  }
  out = out.replace(/\s*\([A-Z0-9][A-Z0-9-]{3,}\)\s*$/, '')
  return out.trim()
}

export function cleanName(raw: string, sku: string | null, platformNames: string[] = []): string {
  return titleCaseName(stripTrailingSku(stripVehicleDecorations(raw, platformNames), sku))
}

// Years formatting, shared by /q and the lookbook.
export function formatYears(years: string | null | undefined): string {
  return (years || '').replace(/-/g, '–').replace(/\s+/g, ' ').trim()
}
