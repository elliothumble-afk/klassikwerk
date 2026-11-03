import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { LookbookPdfInput, LookbookOption, LookbookTyre } from './types'
import { money } from './types'
import { resolveFamily } from './fonts'

// 16:9 landscape at 72dpi — matches the 960×540 of the reference PDF.
const PAGE_W = 960
const PAGE_H = 540

// Palette — deep green + cream + bronze from the reference.
const GREEN = '#2B4A3E'
const CREAM = '#F2EFE6'
const BRONZE = '#8B6B3E'
const CHARCOAL = '#1F2420'
const INK = '#2A2E2A'

// ─── Text cleanup helpers ────────────────────────────────────────
// Shopify option names arrive in three vehicle-decorated shapes we
// want to normalise before showing in the lookbook:
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
// (YYYY+)" shape bounded by the string edge, case-insensitive on
// the "for" / "Onwards" / "Present" keywords.

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

function stripVehicleDecorations(name: string, platformNames: string[] = []): string {
  if (!name) return ''
  let out = name.trim()
  // 1. Leading "Platform (years) [-|–|:] " prefix.
  const leading = new RegExp(`^\\s*${PLATFORM_NAME}\\s*${YEARS_PAREN}\\s*[-–—:]?\\s*`)
  out = out.replace(leading, '')
  // 2. Trailing " [for] Platform (years)" suffix. The "for" is
  //    required when the suffix is preceded by non-platform words,
  //    otherwise the greedy PLATFORM_NAME alternation would eat the
  //    whole option label ("Large Rear Roof Wing for ..." → "Large").
  //    Allow "for"-less when preceded by nothing (i.e. the whole
  //    string is a trailing-only platform mention).
  const trailingWithFor = new RegExp(`\\s+${FOR_WORD}\\s+${PLATFORM_NAME}\\s*${YEARS_PAREN}\\s*$`)
  out = out.replace(trailingWithFor, '')
  const trailingAlone = new RegExp(`^${PLATFORM_NAME}\\s*${YEARS_PAREN}\\s*$`)
  out = out.replace(trailingAlone, '')
  // 3. Leading platform NAME alone (no years paren). Only matches when
  //    the leading tokens exactly spell one of the known catalog
  //    platforms, so we never over-strip. Covers titles like "Land
  //    Rover Defender 110 Designo Pattern Leather Interior" where the
  //    year parenthetical is absent.
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
  // 4. Drop trailing "(n)" numeric disambiguators that Shopify sometimes
  //    appends when a duplicate handle is minted. "Wheels (1)" → "Wheels".
  out = out.replace(/\s*\(\d+\)\s*$/, '')
  return out.trim()
}

// ─── All-caps → Title Case ───────────────────────────────────────
// Shopify copy routinely ships option names in SHOUT-CAPS ("LAND
// ROVER DEFENDER (1991-2016) FRONT BUMPER SUMP GUARD"). The lookbook
// is a customer-facing document, so we re-case any run of ALL-CAPS
// words to Title Case while preserving a short list of acronyms the
// catalog actually uses in uppercase. Mixed-case names are left
// alone — Shopify writers who typed "Side Vents and CTC badges"
// knew what they were doing.
const KEEP_AS_IS = new Set([
  // Builder/brand acronyms + wheel/finish codes.
  'AMG', 'CTC', 'RS', 'DC', 'LED', 'KO3', 'G22', 'G63', 'G350', 'G400', 'UK',
  // Roman numerals used in trim designations (Series II, Mk III, …).
  'II', 'III', 'IV',
  // Tyre + engine tokens. V8/P525/P400/D300 already survive the single-
  // letter+digits regex but we list them explicitly so intent is clear.
  'LT', 'V8', 'P525', 'P400', 'D300',
])
// Articles / conjunctions / short prepositions that stay lowercase
// mid-string in English title case.
const MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on',
  'or', 'the', 'to', 'with',
])

function titleCaseSubtoken(w: string): string {
  if (!w) return w
  if (KEEP_AS_IS.has(w)) return w
  // "UK26" / "RS22" etc.: an all-caps prefix in KEEP_AS_IS followed by
  // digits is a model code; preserve verbatim.
  const prefixMatch = /^([A-Z]+)(\d+)$/.exec(w)
  if (prefixMatch && KEEP_AS_IS.has(prefixMatch[1])) return w
  // Convert if the whole subtoken is uppercase alphanumeric (letters +
  // optional digits) AND has at least two letters.
  if (/^[A-Z0-9]+$/.test(w) && (w.match(/[A-Z]/g)?.length ?? 0) >= 2) {
    return w[0] + w.slice(1).toLowerCase()
  }
  return w
}

function titleCaseToken(token: string): string {
  // Split on hyphens / slashes so sub-pieces are evaluated separately:
  // "RS-FORGED" → "RS" (keep) + "FORGED" → "Forged".
  return token.split(/([-/])/).map(part =>
    /^[-/]$/.test(part) ? part : titleCaseSubtoken(part),
  ).join('')
}

function titleCaseName(name: string): string {
  if (!name) return ''
  const parts = name.split(/(\s+)/)
  // Index of the first / last non-whitespace token so we know which
  // positions are allowed to stay as minor-word lowercase.
  const wordIdx: number[] = []
  parts.forEach((p, i) => { if (!/^\s+$/.test(p)) wordIdx.push(i) })
  const firstWord = wordIdx[0] ?? -1
  const lastWord = wordIdx[wordIdx.length - 1] ?? -1
  return parts.map((p, i) => {
    if (/^\s+$/.test(p)) return p
    const tc = titleCaseToken(p)
    // Only lowercase minor words in the middle, never at the ends.
    const isEdge = i === firstWord || i === lastWord
    if (!isEdge && MINOR_WORDS.has(tc.toLowerCase())) return tc.toLowerCase()
    return tc
  }).join('')
}

function stripTrailingSku(name: string, sku: string | null): string {
  if (!name) return ''
  let out = name.trim()
  // Drop a trailing "(CODE)" that matches the row's kit_sku/code — case
  // insensitive. If no sku is known, drop any trailing all-caps/digits
  // parenthetical as a best-effort disambiguator strip.
  if (sku) {
    const pat = sku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`\\s*\\(${pat}\\)\\s*$`, 'i'), '')
  }
  out = out.replace(/\s*\([A-Z0-9][A-Z0-9-]{3,}\)\s*$/, '')
  return out.trim()
}

function cleanName(raw: string, _platformName: string, sku: string | null, platformNames: string[] = []): string {
  return titleCaseName(stripTrailingSku(stripVehicleDecorations(raw, platformNames), sku))
}

// Shopify descriptions often open with a title repeat ("Comfort Leather
// Interior – INEOS Grenadier Transform the interior of your..."). We
// strip the first sentence when it visibly repeats words from the
// option name, so the lookbook copy reads as prose from the start.

function stripLeadingTitle(desc: string | null, cleanedName: string): string {
  if (!desc) return ''
  const trimmed = desc.trim()
  if (!trimmed) return ''
  // Prefer the em-dash boundary + the first upper-cased word after it,
  // which matches the Shopify "Title – Platform Prose..." pattern.
  const dashIdx = trimmed.search(/\s[–—-]\s/)
  if (dashIdx !== -1 && dashIdx < 90) {
    const after = trimmed.slice(dashIdx + 3)
    // Jump to the first sentence-start capital after the platform repeat.
    const start = after.search(/\s[A-Z][a-z]/)
    if (start !== -1 && start < 80) return after.slice(start + 1).trim()
  }
  // Fallback: first sentence. If it echoes ≥2 title words, drop it.
  const sentences = trimmed.split(/(?<=[.!?])\s+(?=[A-Z"])/)
  if (sentences.length >= 2) {
    const firstWords = new Set(
      cleanedName.toLowerCase().split(/\s+/).filter(w => w.length > 3),
    )
    const firstSentWords = sentences[0].toLowerCase().split(/\W+/)
    const shared = firstSentWords.filter(w => firstWords.has(w)).length
    if (shared >= 2) return sentences.slice(1).join(' ').trim()
  }
  return trimmed
}

// Years come in as "2023–present" or "1991-2016". Normalise the dash
// so At a Glance always reads with an en-dash.
function formatYears(years: string): string {
  return (years || '').replace(/-/g, '–').replace(/\s+/g, ' ').trim()
}

// Extract a size tag like "20-inch, forged" for a wheel option.
// Shopify tags aren't persisted, so we fall back to parsing the name
// + description for "20"" / "20-inch" patterns and append ", forged"
// when the name says so.
function wheelSizeTag(name: string, description: string | null = null): string | null {
  const re = /(\d{2})\s*(?:["”]|-?inch|-?in\b)/i
  const m = re.exec(name) ?? (description ? re.exec(description) : null)
  if (!m) return null
  const inches = m[1]
  const forged = /forged/i.test(name) || (description ? /forged/i.test(description) : false)
    ? ', forged' : ''
  return `${inches}-inch${forged}`
}

// Human label for a payment-schedule trigger key.
const TRIGGER_LABELS: Record<string, string> = {
  acceptance: 'On acceptance',
  reservation: 'Reservation',
  contract: 'Contract signing',
  samples: 'Paint sample sign-off',
  pre_production: 'Before production',
  production: 'Production start',
  pre_delivery: 'Before delivery',
  delivery: 'Delivery',
  pickup: 'Pickup',
  final: 'Final payment',
}
function triggerLabel(trigger: string): string {
  return TRIGGER_LABELS[trigger] ?? trigger.replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase())
}

// Normalise a vehicle_colour string into a display + optional hex.
// Supports plain names ("Carpathian Grey"), optional hex in brackets
// ("Carpathian Grey [#5B5F62]"), or a leading hex ("#5B5F62 Carpathian").
function parseVehicleColour(input: string | null | undefined) {
  if (!input) return null
  const txt = input.trim()
  const bracket = /\[(#[0-9a-f]{3,8})\]/i.exec(txt)
  if (bracket) return { name: txt.replace(bracket[0], '').trim(), hex: bracket[1] }
  const leading = /^(#[0-9a-f]{3,8})\s+(.+)$/i.exec(txt)
  if (leading) return { name: leading[2].trim(), hex: leading[1] }
  return { name: txt, hex: null as string | null }
}

export function LookbookPdf(input: LookbookPdfInput) {
  const {
    builder, brand, terms, operator_contact, closing_signer,
    platform, all_platform_names, tier, options, tyres, wheel_options,
    customer_first_name, theme_words, vehicle_colour, vehicle_year,
    page2_hero_url,
  } = input
  const currency = terms.currency
  // The Lookbook has a fixed type system (Cormorant Garamond + DM Sans)
  // regardless of the brand's font_display / font_body — the design
  // language is builder-neutral until someone asks for it to vary.
  // renderLookbookPdfToStorage registers these two before calling in.
  const display = resolveFamily('Cormorant Garamond')
  const body    = resolveFamily('DM Sans')

  // Base + palette.
  const base = StyleSheet.create({
    cream: {
      backgroundColor: CREAM, color: INK, fontFamily: body,
      paddingVertical: 48, paddingHorizontal: 56,
    },
    green: {
      backgroundColor: GREEN, color: CREAM, fontFamily: body,
      paddingVertical: 48, paddingHorizontal: 56,
    },
    label: {
      fontFamily: body, fontSize: 9, letterSpacing: 2,
      textTransform: 'uppercase', color: BRONZE,
    },
    labelLight: {
      fontFamily: body, fontSize: 9, letterSpacing: 2,
      textTransform: 'uppercase', color: CREAM + 'AA',
    },
    display: { fontFamily: display, fontSize: 48, lineHeight: 1.1 },
    h1: { fontFamily: display, fontSize: 36, lineHeight: 1.15 },
    h2: { fontFamily: display, fontSize: 28, lineHeight: 1.2 },
    body: { fontFamily: body, fontSize: 11, lineHeight: 1.5, color: INK },
    bodyLight: { fontFamily: body, fontSize: 11, lineHeight: 1.5, color: CREAM + 'DD' },
    small: { fontFamily: body, fontSize: 8, color: INK + '99' },
    smallLight: { fontFamily: body, fontSize: 8, color: CREAM + '99' },
    footer: {
      position: 'absolute', left: 56, right: 56, bottom: 24,
      flexDirection: 'row', justifyContent: 'space-between',
    },
  })

  // Prefer the operator's company name (Humble House); fall back to
  // the contact.name field or a sensible default.
  const operatorName = operator_contact.name ?? 'Humble House'
  const customerName = customer_first_name ?? 'you'

  // Vehicle colour is text only — the palette card is name-only, so
  // we only need the display name.
  const vColour = parseVehicleColour(vehicle_colour)

  // ─── Grouping ──────────────────────────────────────────────────
  // Section → options, sorted by section_sort then option name.
  interface SectionGroup { section: string; sort: number; opts: LookbookOption[] }
  const sectionMap = new Map<string, SectionGroup>()
  for (const o of options) {
    const label = o.section ?? 'Other'
    const g = sectionMap.get(label) ?? { section: label, sort: o.section_sort, opts: [] }
    g.opts.push(o)
    g.sort = Math.min(g.sort || Number.MAX_SAFE_INTEGER, o.section_sort)
    sectionMap.set(label, g)
  }
  const sections = [...sectionMap.values()].sort((a, b) => a.sort - b.sort)

  const validUntil = new Date(new Date(input.created_at).getTime() + (terms.quote_validity_days ?? 30) * 86400_000)
    .toISOString().slice(0, 10)

  // Hide the footer on image-dominant pages so the long legal name
  // doesn't overprint a photo.
  const Footer = ({ dark = false }: { dark?: boolean }) => (
    <View style={base.footer} fixed>
      <Text style={dark ? base.smallLight : base.small}>
        {builder.legal_name ?? builder.name}
      </Text>
      <Text style={dark ? base.smallLight : base.small}>
        Quote v{input.version} · {operatorName}
      </Text>
    </View>
  )

  // ─── Shared row renderers ───────────────────────────────────────
  function investLine(item: string, finish: string, qty: string, price: string, key: string) {
    return <InvestRow key={key} item={item} finish={finish} qty={qty} price={price} />
  }

  // The at-a-glance "Base vehicle" line should read as "Chassis · Years".
  const baseVehicle = `${platform.name} · ${formatYears(platform.years)}`

  return (
    <Document
      title={`${customerName}'s ${platform.name} Package`}
      author={operatorName}
    >

      {/* ─── 1. Cover (green) ─────────────────────────────────────── */}
      <Page size={{ width: PAGE_W, height: PAGE_H }} style={base.green}>
        <View style={{ flex: 1, justifyContent: 'space-between' }}>
          <View>
            {brand.logo_url
              ? <Image src={brand.logo_url} style={{ width: 140, height: 42, objectFit: 'contain' }} />
              : <Text style={{ fontFamily: display, fontSize: 20, color: CREAM }}>{brand.wordmark_text ?? builder.name}</Text>}
          </View>
          <View style={{ maxWidth: 720 }}>
            <Text style={base.labelLight}>PREPARED FOR {(customerName || 'YOU').toUpperCase()}</Text>
            <Text style={[base.display, { marginTop: 18, color: CREAM, fontSize: 58 }]}>
              The {platform.name}
            </Text>
            <Text style={[base.bodyLight, { marginTop: 14, maxWidth: 560 }]}>
              A {builder.name} commission, curated by {operatorName}.
            </Text>
            {theme_words && (
              <Text style={{ fontFamily: display, fontSize: 20, color: CREAM + 'DD', marginTop: 20 }}>
                {theme_words}
              </Text>
            )}
          </View>
        </View>
        <Footer dark />
      </Page>

      {/* ─── 2. Your {platform} — full-bleed hero ─── */}
      {/* Hero fills the page; a stacked dark-overlay footer carries
          THE FOUNDATION label, "{year} {platform}" title and vehicle
          colour. Nothing else lives on this page. */}
      {(() => {
        const title = [vehicle_year ? String(vehicle_year) : null, platform.name]
          .filter(Boolean).join(' ')
        const footerH = 210
        // Three stacked semi-transparent panels approximate a dark
        // bottom-to-top gradient without @react-pdf gradient primitives.
        const bands = [
          { h: footerH,            opacity: 0.85 },  // bottom (darkest)
          { h: Math.round(footerH * 0.70), opacity: 0.55 },
          { h: Math.round(footerH * 0.40), opacity: 0.25 },
        ]
        return (
          <Page key="page2" size={{ width: PAGE_W, height: PAGE_H }} style={{
            backgroundColor: CHARCOAL, color: CREAM, fontFamily: body, padding: 0,
          }}>
            {page2_hero_url && (
              <Image
                src={page2_hero_url}
                style={{
                  position: 'absolute', top: 0, left: 0,
                  width: PAGE_W, height: PAGE_H,
                  objectFit: 'cover',
                  objectPosition: '50% 40%',
                }}
              />
            )}
            {/* Dark gradient-approx overlay. */}
            {bands.map((b, i) => (
              <View key={i} style={{
                position: 'absolute', left: 0, right: 0, bottom: 0,
                height: b.h,
                backgroundColor: `rgba(0, 0, 0, ${b.opacity})`,
              }} />
            ))}
            <View style={{
              position: 'absolute', left: 56, right: 56, bottom: 48,
            }}>
              <Text style={[base.labelLight, { color: CREAM + 'CC' }]}>THE FOUNDATION</Text>
              <Text style={{
                fontFamily: display, fontSize: 42, color: CREAM,
                marginTop: 10, lineHeight: 1.1,
              }}>
                {title}
              </Text>
              {vColour?.name && (
                <Text style={{
                  fontFamily: display, fontSize: 18, color: CREAM + 'DD',
                  marginTop: 6,
                }}>
                  {vColour.name}
                </Text>
              )}
            </View>
          </Page>
        )
      })()}

      {/* ─── 4+. One page per selected option (sections ordered) ─ */}
      {sections.flatMap((section, sectionIdx) =>
        section.opts.map((o, i) => {
          const idx = sectionIdx * 100 + i
          const imageLeft = idx % 2 === 0
          const img = o.image_url ?? o.swatch_image_url
          const name = cleanName(o.name, platform.name, o.code, all_platform_names)
          const desc = stripLeadingTitle(o.description, name)
          const finishLine = [
            o.finishes.map(f => f.name).filter(Boolean).join(' · '),
            o.finish_note ?? '',
          ].filter(Boolean).join(' — ')
          const half = PAGE_W / 2
          return (
            <Page key={`opt-${o.option_id}`} size={{ width: PAGE_W, height: PAGE_H }} style={{
              backgroundColor: CREAM, color: INK, fontFamily: body, padding: 0,
            }}>
              <View style={{
                flexDirection: imageLeft ? 'row' : 'row-reverse',
                width: PAGE_W, height: PAGE_H,
              }}>
                <View style={{ width: half, height: PAGE_H }}>
                  {img ? (
                    <Image src={img} style={{ width: half, height: PAGE_H, objectFit: 'cover' }} />
                  ) : (
                    <View style={{ width: half, height: PAGE_H, backgroundColor: CHARCOAL + '18' }} />
                  )}
                </View>
                <View style={{ width: half, height: PAGE_H, padding: 48, justifyContent: 'center' }}>
                  <Text style={base.label}>{(o.section ?? 'OPTION').toUpperCase()}</Text>
                  <Text style={[base.h2, { marginTop: 10 }]}>{name}</Text>
                  {desc && (
                    <Text style={[base.body, { marginTop: 16 }]}>{desc}</Text>
                  )}
                  {finishLine && (
                    <Text style={[base.body, { marginTop: 16, fontSize: 10, color: BRONZE }]}>{finishLine}</Text>
                  )}
                </View>
              </View>
              {/* No footer — full-bleed image side would overlap. */}
            </Page>
          )
        }),
      )}

      {/* ─── Wheels page: cards per wheel + tyre sentence ───────── */}
      {wheel_options.length > 0 && (
        <Page size={{ width: PAGE_W, height: PAGE_H }} style={base.cream}>
          <Text style={base.label}>WHEELS</Text>
          <Text style={[base.h2, { marginTop: 6 }]}>Your wheels</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 20, gap: 16 }}>
            {wheel_options.map(w => {
              const name = cleanName(w.name, platform.name, w.code, all_platform_names)
              const sizeTag = wheelSizeTag(w.name, w.description)
              const img = w.image_url ?? w.swatch_image_url
              return (
                <View key={w.option_id} style={{
                  width: 240, height: 300, padding: 14,
                  borderRadius: 4, border: `0.5 solid ${INK}22`, backgroundColor: '#FFFFFF',
                }}>
                  <View style={{ flex: 1, borderRadius: 2, backgroundColor: CHARCOAL + '12', marginBottom: 10 }}>
                    {img && <Image src={img} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 2 }} />}
                  </View>
                  <Text style={{ fontFamily: display, fontSize: 14 }}>{name}</Text>
                  {sizeTag && <Text style={[base.body, { fontSize: 9, color: BRONZE, marginTop: 2 }]}>{sizeTag}</Text>}
                  {w.finishes.length > 0 && (
                    <Text style={[base.body, { fontSize: 9, marginTop: 6 }]}>
                      {w.finishes.map(f => f.name).join(' · ')}
                    </Text>
                  )}
                </View>
              )
            })}
          </View>
          {tyres.length > 0 && (
            <Text style={[base.body, { marginTop: 20, color: INK + 'B0' }]}>
              Fitted with {tyres.map(t => cleanName(t.name, platform.name, t.code, all_platform_names)).join(' or ')} — sized and selected for the chosen wheel fitment.
            </Text>
          )}
          <Footer />
        </Page>
      )}

      {/* ─── Statement (green) ──────────────────────────────────── */}
      {brand.lookbook_statement && (
        <Page size={{ width: PAGE_W, height: PAGE_H }} style={base.green}>
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={[base.labelLight, { marginBottom: 24 }]}>{builder.name.toUpperCase()}</Text>
            <Text style={{ fontFamily: display, fontSize: 44, color: CREAM, textAlign: 'center', maxWidth: 600, lineHeight: 1.15 }}>
              {brand.lookbook_statement}
            </Text>
          </View>
          <Footer dark />
        </Page>
      )}

      {/* ─── At a Glance ────────────────────────────────────────── */}
      {/* Scales row density to fit up to 14 rows on one page; splits
          into "(continued)" pages beyond that. */}
      {(() => {
        interface GlanceRowSpec { label: string; value: string }
        const rows: GlanceRowSpec[] = [
          { label: 'Base vehicle', value: baseVehicle },
          { label: 'Vehicle colour', value: vColour?.name ?? '—' },
          ...sections.map(sec => ({
            label: sec.section,
            value: sec.opts.map(o => cleanName(o.name, platform.name, o.code, all_platform_names)).join('; '),
          })),
          ...(wheel_options.length > 0 ? [{
            label: 'Wheels',
            value: wheel_options.map(w => {
              const name = cleanName(w.name, platform.name, w.code, all_platform_names)
              const size = wheelSizeTag(w.name, w.description)
              return size ? `${name} (${size})` : name
            }).join(' or '),
          }] : []),
          ...(tyres.length > 0 ? [{
            label: 'Tyres',
            value: tyres.map(t => cleanName(t.name, platform.name, t.code, all_platform_names)).join(' or '),
          }] : []),
        ]
        const MAX_PER_PAGE = 14
        const pages: GlanceRowSpec[][] = []
        for (let i = 0; i < rows.length; i += MAX_PER_PAGE) {
          pages.push(rows.slice(i, i + MAX_PER_PAGE))
        }
        // Density scales row padding so 1 → spacious, 14 → tight.
        const padFor = (n: number) =>
          n <= 7 ? 14 : n <= 10 ? 10 : n <= 12 ? 8 : 6
        return pages.map((pageRows, pi) => {
          const padV = padFor(pageRows.length)
          const continued = pi > 0
          return (
            <Page key={`glance-${pi}`} size={{ width: PAGE_W, height: PAGE_H }} style={base.cream}>
              <Text style={base.label}>{(customerName.toUpperCase())}'S PACKAGE</Text>
              <Text style={[base.h1, { marginTop: 6 }]}>
                At a Glance{continued && <Text style={[base.body, { color: INK + '88' }]}>  (continued)</Text>}
              </Text>
              <View style={{ marginTop: 20, borderTop: `0.5 solid ${INK}33` }}>
                {pageRows.map((r, i) => (
                  <GlanceRow key={i} label={r.label} value={r.value} padV={padV} />
                ))}
              </View>
              <Footer />
            </Page>
          )
        })
      })()}

      {/* ─── Investment ────────────────────────────────────────── */}
      {/* Target: fit header, table + total, schedule and validity on
          ONE page even with 10+ options. Row paddings are tight on
          purpose. */}
      <Page size={{ width: PAGE_W, height: PAGE_H }} style={base.cream}>
        <Text style={base.label}>INVESTMENT</Text>
        <Text style={[base.h2, { marginTop: 2 }]}>Your package</Text>
        <View style={{ marginTop: 10 }}>
          <View style={{ flexDirection: 'row', borderBottom: `0.5 solid ${INK}66`, paddingBottom: 5 }}>
            <Text style={[base.label, { flex: 2 }]}>Item</Text>
            <Text style={[base.label, { flex: 1.5 }]}>Finish</Text>
            <Text style={[base.label, { width: 48, textAlign: 'right' }]}>Qty</Text>
            <Text style={[base.label, { width: 110, textAlign: 'right' }]}>Price</Text>
          </View>
          {tier.base_price_cents != null && tier.base_price_cents > 0 && investLine(tier.name, '', '', money(tier.base_price_cents, currency), 'tier')}
          {sections.flatMap(sec => sec.opts.map(o => investLine(
            cleanName(o.name, platform.name, o.code, all_platform_names),
            o.finishes.map(f => f.name).join(', '),
            o.sold_as_set ? 'Set of 4' : o.quantity > 1 ? `×${o.quantity}` : '',
            money(o.line_price_cents, currency),
            o.option_id,
          )))}
          {wheel_options.map(w => investLine(
            cleanName(w.name, platform.name, w.code, all_platform_names),
            w.finishes.map(f => f.name).join(', '),
            w.sold_as_set ? 'Set of 4' : w.quantity > 1 ? `×${w.quantity}` : '',
            money(w.line_price_cents, currency),
            w.option_id,
          ))}
          {tyres.map((t: LookbookTyre, i) => investLine(
            cleanName(t.name, platform.name, t.code, all_platform_names),
            '',
            t.sold_as_set ? 'Set of 4' : t.quantity > 1 ? `×${t.quantity}` : '',
            money(t.line_price_cents, currency),
            `tyre-${i}`,
          ))}
          <View style={{ flexDirection: 'row', paddingTop: 6, marginTop: 2, borderTop: `0.5 solid ${INK}66` }}>
            <Text style={[base.body, { flex: 2, fontFamily: display, fontSize: 14 }]}>Total</Text>
            <Text style={[base.body, { flex: 1.5 }]} />
            <Text style={[base.body, { width: 48 }]} />
            <Text style={[base.body, { width: 110, textAlign: 'right', fontFamily: display, fontSize: 14, color: BRONZE }]}>
              {money(input.price_cents, currency)}
            </Text>
          </View>
        </View>

        {/* Keep PAYMENT SCHEDULE + the "Prices include…" validity note
            on the same page by wrapping both in a non-breaking View.
            Previously the schedule fit at the bottom and the footnote
            spilled onto a blank page. */}
        <View wrap={false} style={{ marginTop: 8 }}>
          {terms.payment_schedule.length > 0 && (
            <View>
              <Text style={base.label}>PAYMENT SCHEDULE</Text>
              <View style={{ marginTop: 2 }}>
                <ScheduleRow label="Reservation deposit" trigger="On acceptance" value={money(terms.reservation_cents, currency)} />
                {terms.payment_schedule.map((s, i) => (
                  <ScheduleRow key={i} label={s.label} trigger={triggerLabel(s.trigger)}
                    value={`${s.percent}% · ${money(Math.round((Math.max(0, input.price_cents - terms.reservation_cents) * s.percent) / 100), currency)}`}
                  />
                ))}
              </View>
            </View>
          )}
          <Text style={[base.small, { marginTop: 8 }]}>
            Prices include import shipping, duties and fitting. Valid until {validUntil}.
          </Text>
        </View>
        <Footer />
      </Page>

      {/* ─── Closing (green) ──────────────────────────────────── */}
      <Page size={{ width: PAGE_W, height: PAGE_H }} style={base.green}>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          {brand.logo_url
            ? <Image src={brand.logo_url} style={{ width: 160, height: 48, objectFit: 'contain', marginBottom: 32 }} />
            : <Text style={[base.h2, { color: CREAM, marginBottom: 32 }]}>{brand.wordmark_text ?? builder.name}</Text>}
          <Text style={[base.display, { fontSize: 46, color: CREAM }]}>Let's design yours together.</Text>
          <Text style={[base.bodyLight, { marginTop: 24, maxWidth: 540 }]}>
            I'm always available to chat. Please feel free to call or text me now, or you can schedule a time by simply replying to this email with the best day and time.
          </Text>
          <View style={{ marginTop: 36 }}>
            {closing_signer.name && <Text style={{ fontFamily: display, fontSize: 20, color: CREAM }}>{closing_signer.name}</Text>}
            {closing_signer.title && <Text style={[base.bodyLight, { marginTop: 2 }]}>{closing_signer.title}</Text>}
            {(closing_signer.phone || closing_signer.email) && (
              <Text style={[base.bodyLight, { marginTop: 10, color: BRONZE }]}>
                {closing_signer.phone ? `Call/Text/WhatsApp: ${closing_signer.phone}` : ''}
                {closing_signer.phone && closing_signer.email ? ' · ' : ''}
                {closing_signer.email ?? ''}
              </Text>
            )}
          </View>
        </View>
        <Footer dark />
      </Page>
    </Document>
  )
}

function GlanceRow({ label, value, padV = 10 }: { label: string; value: string; padV?: number }) {
  const bodyFs = padV <= 7 ? 10 : 11
  const labelFs = padV <= 7 ? 8 : 9
  return (
    <View style={{ flexDirection: 'row', paddingVertical: padV, borderBottom: `0.5 solid ${INK}22` }}>
      <Text style={{ fontFamily: 'Helvetica', fontSize: labelFs, letterSpacing: 2, textTransform: 'uppercase', color: BRONZE, width: 180 }}>{label}</Text>
      <Text style={{ fontFamily: 'Helvetica', fontSize: bodyFs, color: INK, flex: 1, lineHeight: 1.4 }}>{value}</Text>
    </View>
  )
}

function InvestRow({ item, finish, qty, price }: { item: string; finish: string; qty: string; price: string }) {
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 3, borderBottom: `0.5 solid ${INK}22` }}>
      <Text style={{ fontFamily: 'Helvetica', fontSize: 9, flex: 2 }}>{item}</Text>
      <Text style={{ fontFamily: 'Helvetica', fontSize: 9, flex: 1.5, color: INK + '99' }}>{finish}</Text>
      <Text style={{ fontFamily: 'Helvetica', fontSize: 9, width: 48, textAlign: 'right', color: INK + '99' }}>{qty}</Text>
      <Text style={{ fontFamily: 'Helvetica', fontSize: 9, width: 110, textAlign: 'right' }}>{price}</Text>
    </View>
  )
}

function ScheduleRow({ label, trigger, value }: { label: string; trigger: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 2, borderBottom: `0.5 solid ${INK}22` }}>
      <Text style={{ fontFamily: 'Helvetica', fontSize: 9, flex: 1 }}>{label}</Text>
      <Text style={{ fontFamily: 'Helvetica', fontSize: 9, flex: 1, color: INK + '99' }}>{trigger}</Text>
      <Text style={{ fontFamily: 'Helvetica', fontSize: 9, width: 140, textAlign: 'right' }}>{value}</Text>
    </View>
  )
}
