import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { LookbookPdfInput, LookbookOption } from './types'
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

export function LookbookPdf(input: LookbookPdfInput) {
  const {
    builder, brand, terms, operator_contact, closing_signer,
    platform, tier, options, tyres, wheel_options,
    customer_first_name, theme_words, vehicle_colour,
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

  const platformHero = platform.hero_image_url ?? null

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

  // Finishes that appear across the quote, deduped, for the Mood swatch strip.
  const moodFinishes = Array.from(new Set(options.flatMap(o => o.finishes.map(f => f.name)).filter(Boolean)))

  // ─── Footer ─────────────────────────────────────────────────────
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

  // ─── Swatch ────────────────────────────────────────────────────
  // Named colour chips used on p2 + Mood.
  function SwatchCard({ title, subtitle, dark = false }: { title: string; subtitle?: string; dark?: boolean }) {
    return (
      <View style={{
        width: 160, height: 180, marginRight: 16, marginBottom: 16,
        padding: 14, borderRadius: 4,
        backgroundColor: dark ? CREAM + '18' : '#FFFFFF',
        border: `0.5 solid ${dark ? CREAM + '33' : INK + '22'}`,
      }}>
        <View style={{
          flex: 1, borderRadius: 2, marginBottom: 10,
          backgroundColor: dark ? CREAM + '22' : CHARCOAL + '18',
        }} />
        <Text style={{ fontFamily: display, fontSize: 14, color: dark ? CREAM : INK }}>{title}</Text>
        {subtitle && <Text style={[dark ? base.bodyLight : base.body, { fontSize: 9, marginTop: 2 }]}>{subtitle}</Text>}
      </View>
    )
  }

  return (
    <Document
      title={`${customerName}'s ${platform.name} Package`}
      author={operatorName}
    >

      {/* ─── 1. Cover ──────────────────────────────────────────── */}
      <Page size={{ width: PAGE_W, height: PAGE_H }} style={base.cream}>
        <View style={{ flexDirection: 'row', height: '100%' }}>
          <View style={{ flex: 1.1, justifyContent: 'space-between', paddingRight: 32 }}>
            <View>
              {brand.logo_url
                ? <Image src={brand.logo_url} style={{ width: 120, height: 36, objectFit: 'contain' }} />
                : <Text style={{ fontFamily: display, fontSize: 20 }}>{brand.wordmark_text ?? builder.name}</Text>}
            </View>
            <View>
              <Text style={base.label}>PREPARED FOR {(customerName || 'YOU').toUpperCase()}</Text>
              <Text style={[base.display, { marginTop: 16 }]}>
                The {platform.name}
              </Text>
              <Text style={[base.body, { marginTop: 16, color: INK + 'B0' }]}>
                A {builder.name} commission, curated by {operatorName}.
              </Text>
              {theme_words && (
                <Text style={[base.body, { marginTop: 10, fontFamily: display, fontSize: 16, color: BRONZE }]}>
                  {theme_words}
                </Text>
              )}
            </View>
          </View>
          <View style={{ flex: 1, backgroundColor: GREEN + '14', borderRadius: 4 }}>
            {platformHero
              ? <Image src={platformHero} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }} />
              : null}
          </View>
        </View>
        <Footer />
      </Page>

      {/* ─── 2. Your {platform} ────────────────────────────────── */}
      <Page size={{ width: PAGE_W, height: PAGE_H }} style={base.cream}>
        <View style={{ flexDirection: 'row', height: '100%', gap: 32 }}>
          <View style={{ flex: 1.3 }}>
            <Text style={base.label}>THE FOUNDATION</Text>
            <Text style={[base.h1, { marginTop: 12 }]}>{platform.name}</Text>
            <Text style={[base.body, { marginTop: 20, maxWidth: 460 }]}>
              {platform.lookbook_copy ?? ''}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[base.label, { marginBottom: 12 }]}>YOUR COLOURS</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {vehicle_colour && <SwatchCard title={vehicle_colour} subtitle="Vehicle colour" />}
              {options.some(o => (o.category_name === 'Leather interior')) && (
                <SwatchCard title="Interior" subtitle={
                  options.find(o => o.category_name === 'Leather interior')?.finishes.map(f => f.name).join(', ') || 'As specified'
                } />
              )}
            </View>
          </View>
        </View>
        <Footer />
      </Page>

      {/* ─── 3. The Mood ──────────────────────────────────────── */}
      <Page size={{ width: PAGE_W, height: PAGE_H }} style={{ ...base.cream, padding: 0 }}>
        <View style={{ position: 'relative', width: '100%', height: 320 }}>
          {platformHero ? (
            <Image src={platformHero} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <View style={{ width: '100%', height: '100%', backgroundColor: GREEN + '30' }} />
          )}
        </View>
        <View style={{ paddingVertical: 32, paddingHorizontal: 56 }}>
          <Text style={base.label}>THE MOOD</Text>
          <Text style={[base.h2, { marginTop: 6 }]}>Stealth, texture and warmth</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 20 }}>
            {vehicle_colour && <SwatchCard title={vehicle_colour} subtitle="Vehicle colour" />}
            {moodFinishes.map((f, i) => <SwatchCard key={i} title={f} />)}
          </View>
        </View>
      </Page>

      {/* ─── 4+. One page per selected option (sections ordered) ─ */}
      {sections.flatMap((section, sectionIdx) =>
        section.opts.map((o, i) => {
          const idx = sectionIdx * 100 + i
          const imageLeft = idx % 2 === 0
          const img = o.image_url ?? o.swatch_image_url
          const finishLine = [
            o.finishes.map(f => f.name).filter(Boolean).join(' · '),
            o.finish_note ?? '',
          ].filter(Boolean).join(' — ')
          return (
            <Page key={`opt-${o.option_id}`} size={{ width: PAGE_W, height: PAGE_H }} style={{ ...base.cream, padding: 0 }}>
              <View style={{ flexDirection: imageLeft ? 'row' : 'row-reverse', height: '100%' }}>
                <View style={{ flex: 1 }}>
                  {img ? (
                    <Image src={img} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <View style={{ width: '100%', height: '100%', backgroundColor: CHARCOAL + '18' }} />
                  )}
                </View>
                <View style={{ flex: 1, padding: 56, justifyContent: 'center' }}>
                  <Text style={base.label}>{(o.section ?? 'OPTION').toUpperCase()}</Text>
                  <Text style={[base.h2, { marginTop: 10 }]}>{o.name}</Text>
                  {o.description && (
                    <Text style={[base.body, { marginTop: 16 }]}>{o.description}</Text>
                  )}
                  {finishLine && (
                    <Text style={[base.body, { marginTop: 16, fontSize: 10, color: BRONZE }]}>{finishLine}</Text>
                  )}
                </View>
              </View>
              <Footer />
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
              const sizeTag = w.shopify_tags.find(t => /^\d{2}("|'')?$/.test(t))
              const img = w.image_url ?? w.swatch_image_url
              return (
                <View key={w.option_id} style={{
                  width: 240, height: 300, padding: 14,
                  borderRadius: 4, border: `0.5 solid ${INK}22`, backgroundColor: '#FFFFFF',
                }}>
                  <View style={{ flex: 1, borderRadius: 2, backgroundColor: CHARCOAL + '12', marginBottom: 10 }}>
                    {img && <Image src={img} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 2 }} />}
                  </View>
                  <Text style={{ fontFamily: display, fontSize: 14 }}>{w.name}</Text>
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
              Fitted with {tyres.map(t => t.name).join(' or ')} — sized and selected for the chosen wheel fitment.
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
      <Page size={{ width: PAGE_W, height: PAGE_H }} style={base.cream}>
        <Text style={base.label}>{(customerName.toUpperCase())}'S PACKAGE</Text>
        <Text style={[base.h1, { marginTop: 6 }]}>At a Glance</Text>
        <View style={{ marginTop: 24, borderTop: `0.5 solid ${INK}33` }}>
          <GlanceRow label="Base vehicle" value={`${platform.name} · ${platform.chassis} · ${platform.years}`} />
          <GlanceRow label="Vehicle colour" value={vehicle_colour ?? '—'} />
          {sections.map(sec => (
            <GlanceRow
              key={sec.section}
              label={sec.section}
              value={sec.opts.map(o => o.name).join('; ')}
            />
          ))}
          {wheel_options.length > 0 && (
            <GlanceRow
              label="Wheels"
              value={wheel_options.map(w => w.name).join(' or ')}
            />
          )}
          {tyres.length > 0 && (
            <GlanceRow label="Tyres" value={tyres.map(t => t.name).join(' or ')} />
          )}
        </View>
        <Footer />
      </Page>

      {/* ─── Investment ────────────────────────────────────────── */}
      <Page size={{ width: PAGE_W, height: PAGE_H }} style={base.cream}>
        <Text style={base.label}>INVESTMENT</Text>
        <Text style={[base.h1, { marginTop: 6 }]}>Your package</Text>
        <View style={{ marginTop: 20 }}>
          <View style={{ flexDirection: 'row', borderBottom: `0.5 solid ${INK}66`, paddingBottom: 6 }}>
            <Text style={[base.label, { flex: 2 }]}>Item</Text>
            <Text style={[base.label, { flex: 1.5 }]}>Finish</Text>
            <Text style={[base.label, { width: 48, textAlign: 'right' }]}>Qty</Text>
            <Text style={[base.label, { width: 110, textAlign: 'right' }]}>Price</Text>
          </View>
          {/* Chelsea Conversion base */}
          {tier.base_price_cents != null && tier.base_price_cents > 0 && (
            <InvestRow
              item={tier.name}
              finish=""
              qty=""
              price={money(tier.base_price_cents, currency)}
            />
          )}
          {sections.flatMap(sec => sec.opts.map(o => (
            <InvestRow
              key={o.option_id}
              item={o.name}
              finish={o.finishes.map(f => f.name).join(', ')}
              qty={o.sold_as_set ? 'Set of 4' : o.quantity > 1 ? `×${o.quantity}` : ''}
              price={money(o.line_price_cents, currency)}
            />
          )))}
          {wheel_options.map(w => (
            <InvestRow
              key={w.option_id}
              item={w.name}
              finish={w.finishes.map(f => f.name).join(', ')}
              qty={w.sold_as_set ? 'Set of 4' : w.quantity > 1 ? `×${w.quantity}` : ''}
              price={money(w.line_price_cents, currency)}
            />
          ))}
          <View style={{ flexDirection: 'row', paddingTop: 10, marginTop: 6, borderTop: `0.5 solid ${INK}66` }}>
            <Text style={[base.body, { flex: 2, fontFamily: display, fontSize: 14 }]}>Total</Text>
            <Text style={[base.body, { flex: 1.5 }]} />
            <Text style={[base.body, { width: 48 }]} />
            <Text style={[base.body, { width: 110, textAlign: 'right', fontFamily: display, fontSize: 14, color: BRONZE }]}>
              {money(input.price_cents, currency)}
            </Text>
          </View>
        </View>

        {terms.payment_schedule.length > 0 && (
          <View style={{ marginTop: 18 }}>
            <Text style={base.label}>PAYMENT SCHEDULE</Text>
            <View style={{ marginTop: 6 }}>
              <ScheduleRow label="Reservation deposit" trigger="On acceptance" value={money(terms.reservation_cents, currency)} />
              {terms.payment_schedule.map((s, i) => (
                <ScheduleRow key={i} label={s.label} trigger={s.trigger}
                  value={`${s.percent}% · ${money(Math.round((Math.max(0, input.price_cents - terms.reservation_cents) * s.percent) / 100), currency)}`}
                />
              ))}
            </View>
          </View>
        )}
        <Text style={[base.small, { marginTop: 20 }]}>
          Prices include import shipping, duties and fitting. Valid until {validUntil}.
        </Text>
        <Footer />
      </Page>

      {/* ─── Closing ──────────────────────────────────────────── */}
      <Page size={{ width: PAGE_W, height: PAGE_H }} style={base.cream}>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          {brand.logo_url
            ? <Image src={brand.logo_url} style={{ width: 140, height: 42, objectFit: 'contain', marginBottom: 32 }} />
            : <Text style={[base.h2, { marginBottom: 32 }]}>{brand.wordmark_text ?? builder.name}</Text>}
          <Text style={[base.display, { fontSize: 42 }]}>Let's design yours together.</Text>
          <Text style={[base.body, { marginTop: 24, maxWidth: 540, color: INK + 'B0' }]}>
            I'm always available to chat. Please feel free to call or text me now, or you can schedule a time by simply replying to this email with the best day and time.
          </Text>
          <View style={{ marginTop: 36 }}>
            {closing_signer.name && <Text style={{ fontFamily: display, fontSize: 18 }}>{closing_signer.name}</Text>}
            {closing_signer.title && <Text style={[base.body, { marginTop: 2 }]}>{closing_signer.title}</Text>}
            {(closing_signer.phone || closing_signer.email) && (
              <Text style={[base.body, { marginTop: 8, color: BRONZE }]}>
                {closing_signer.phone ? `Call/Text/WhatsApp: ${closing_signer.phone}` : ''}
                {closing_signer.phone && closing_signer.email ? ' · ' : ''}
                {closing_signer.email ?? ''}
              </Text>
            )}
          </View>
        </View>
        <Footer />
      </Page>
    </Document>
  )
}

function GlanceRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 10, borderBottom: `0.5 solid ${INK}22` }}>
      <Text style={{ fontFamily: 'Helvetica', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: BRONZE, width: 180 }}>{label}</Text>
      <Text style={{ fontFamily: 'Helvetica', fontSize: 11, color: INK, flex: 1, lineHeight: 1.5 }}>{value}</Text>
    </View>
  )
}

function InvestRow({ item, finish, qty, price }: { item: string; finish: string; qty: string; price: string }) {
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 8, borderBottom: `0.5 solid ${INK}22` }}>
      <Text style={{ fontFamily: 'Helvetica', fontSize: 10, flex: 2 }}>{item}</Text>
      <Text style={{ fontFamily: 'Helvetica', fontSize: 10, flex: 1.5, color: INK + '99' }}>{finish}</Text>
      <Text style={{ fontFamily: 'Helvetica', fontSize: 10, width: 48, textAlign: 'right', color: INK + '99' }}>{qty}</Text>
      <Text style={{ fontFamily: 'Helvetica', fontSize: 10, width: 110, textAlign: 'right' }}>{price}</Text>
    </View>
  )
}

function ScheduleRow({ label, trigger, value }: { label: string; trigger: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 6, borderBottom: `0.5 solid ${INK}22` }}>
      <Text style={{ fontFamily: 'Helvetica', fontSize: 10, flex: 1 }}>{label}</Text>
      <Text style={{ fontFamily: 'Helvetica', fontSize: 10, flex: 1, color: INK + '99' }}>{trigger}</Text>
      <Text style={{ fontFamily: 'Helvetica', fontSize: 10, width: 140, textAlign: 'right' }}>{value}</Text>
    </View>
  )
}
