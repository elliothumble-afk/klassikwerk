import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { QuotePdfInput } from './types'
import { money } from './types'
import { resolveFamily } from './fonts'

interface ContactLine {
  text: string
}

function contactLines(c: QuotePdfInput['operator_contact']): ContactLine[] {
  const parts: string[] = []
  if (c.person) parts.push(c.person)
  if (c.email) parts.push(c.email)
  if (c.phone) parts.push(c.phone)
  if (c.website) parts.push(c.website)
  return parts.map(text => ({ text }))
}

function groupOptions(options: QuotePdfInput['options']) {
  const map = new Map<string, QuotePdfInput['options']>()
  const sortByGroup = new Map<string, number>()
  for (const o of options) {
    if (!map.has(o.group_name)) map.set(o.group_name, [])
    map.get(o.group_name)!.push(o)
    if (!sortByGroup.has(o.group_name)) sortByGroup.set(o.group_name, o.group_sort)
  }
  return Array.from(map.entries())
    .sort((a, b) => (sortByGroup.get(a[0]) ?? 0) - (sortByGroup.get(b[0]) ?? 0))
}

export function QuotePdf(input: QuotePdfInput) {
  const { brand, terms, builder, platform, tier, options, customer, operator_contact } = input
  const currency = terms.currency
  const validUntil = new Date(new Date(input.created_at).getTime() + (terms.quote_validity_days ?? 30) * 86400_000)
    .toISOString().slice(0, 10)
  const fontDisplay = resolveFamily(brand.font_display)
  const fontBody = resolveFamily(brand.font_body)

  const styles = StyleSheet.create({
    page: {
      backgroundColor: brand.color_bg,
      color: brand.color_text,
      fontFamily: fontBody,
      fontSize: 10,
      paddingTop: 48,
      paddingBottom: 54,
      paddingHorizontal: 48,
      lineHeight: 1.5,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      borderBottom: `1 solid ${brand.color_text}22`,
      paddingBottom: 12,
      marginBottom: 20,
    },
    wordmark: { fontFamily: fontDisplay, fontSize: 18 },
    headerLogo: { width: 90, height: 32, objectFit: 'contain' },
    tagline: { fontSize: 8, color: brand.color_text + '99', marginTop: 2 },
    small: { fontSize: 8, color: brand.color_text + '99' },
    hero: {
      width: '100%',
      height: 220,
      marginBottom: 16,
      backgroundColor: '#e9e5dc',
    },
    coverTitle: {
      fontFamily: fontDisplay,
      fontSize: 26,
      lineHeight: 1.15,
      marginBottom: 10,
      marginTop: 8,
    },
    coverSub: {
      color: brand.color_text + 'AA',
      fontSize: 10,
      lineHeight: 1.3,
      marginTop: 0,
      marginBottom: 14,
    },
    metaGrid: {
      flexDirection: 'row',
      gap: 20,
      marginTop: 4,
      marginBottom: 24,
    },
    metaCell: { flexDirection: 'column', flexGrow: 1 },
    metaLabel: {
      fontSize: 7,
      letterSpacing: 1,
      color: brand.color_text + '99',
      textTransform: 'uppercase',
      marginBottom: 2,
    },
    metaValue: { fontSize: 11 },
    metaAccent: {
      fontFamily: fontDisplay,
      fontSize: 15,
      color: brand.color_accent,
    },
    h2: {
      fontFamily: fontDisplay,
      fontSize: 15,
      marginTop: 14,
      marginBottom: 10,
    },
    h3: {
      fontFamily: fontDisplay,
      fontSize: 11,
      color: brand.color_accent,
      marginTop: 10,
      marginBottom: 4,
    },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 6,
      borderBottom: `0.5 solid ${brand.color_text}18`,
    },
    swatch: {
      width: 28,
      height: 28,
      borderRadius: 2,
      backgroundColor: '#efece6',
      objectFit: 'cover',
    },
    optionTextWrap: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
    optionName: { fontSize: 10 },
    optionCode: { fontSize: 8, color: brand.color_text + '77' },
    optionPrice: { fontSize: 9, color: brand.color_text + '99', textAlign: 'right', minWidth: 70 },
    scheduleRow: {
      flexDirection: 'row',
      paddingVertical: 6,
      borderBottom: `0.5 solid ${brand.color_text}18`,
    },
    subtotalRow: {
      flexDirection: 'row',
      paddingVertical: 6,
      borderBottom: `0.5 solid ${brand.color_text}22`,
      backgroundColor: '#00000008',
    },
    subtotalText: {
      fontWeight: 'medium',
      color: brand.color_text + 'CC',
    },
    scheduleLabel: { flexGrow: 1, flexShrink: 1, flexBasis: 0, fontSize: 10 },
    scheduleTrigger: { width: 110, color: brand.color_text + '88', fontSize: 9 },
    scheduleAmount: { width: 120, textAlign: 'right', fontSize: 10 },
    totalStrip: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 14,
      padding: 14,
      backgroundColor: '#ffffff',
      borderRadius: 4,
    },
    totalLabel: {
      fontSize: 7,
      letterSpacing: 1,
      color: brand.color_text + '99',
      textTransform: 'uppercase',
    },
    totalCaption: { fontSize: 8, color: brand.color_text + '77', marginTop: 2 },
    totalAmount: { fontFamily: fontDisplay, fontSize: 22 },
    intro: { fontSize: 11, color: brand.color_text + 'CC', marginBottom: 14 },
    processGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 6,
    },
    processCard: {
      width: '48%',
      backgroundColor: '#ffffff',
      borderRadius: 4,
      padding: 12,
    },
    processN: {
      fontFamily: fontDisplay,
      fontSize: 16,
      color: brand.color_accent,
    },
    processLabel: { fontSize: 10, marginTop: 2 },
    processCopy: { fontSize: 9, color: brand.color_text + '88', marginTop: 2 },
    footer: {
      position: 'absolute',
      left: 48,
      right: 48,
      bottom: 24,
      flexDirection: 'row',
      justifyContent: 'space-between',
      borderTop: `0.5 solid ${brand.color_text}22`,
      paddingTop: 10,
    },
    footerContact: { fontSize: 8, color: brand.color_text + '99' },
    footerContactName: { fontSize: 8, color: brand.color_text, marginBottom: 2 },
    warranty: { fontSize: 9, color: brand.color_text + 'AA' },
  })

  const customerName = customer?.full_name ?? customer?.email ?? 'Prospective owner'
  const grouped = groupOptions(options)
  const contact = contactLines(operator_contact)

  const Header = () => (
    <View style={styles.header} fixed>
      <View>
        {brand.logo_url ? (
          <Image src={brand.logo_url} style={styles.headerLogo} />
        ) : (
          <Text style={styles.wordmark}>{brand.wordmark_text ?? builder.name}</Text>
        )}
        {brand.tagline ? <Text style={styles.tagline}>{brand.tagline}</Text> : null}
      </View>
      <Text style={styles.small}>{builder.legal_name ?? builder.name}</Text>
    </View>
  )

  const Footer = () => (
    <View style={styles.footer} fixed>
      <View>
        <Text style={styles.footerContactName}>{operator_contact.name ?? 'Humble House'}</Text>
        <Text style={styles.footerContact}>
          {contact.map(c => c.text).join(' · ')}
        </Text>
      </View>
      <Text style={styles.footerContact}>
        © {new Date().getFullYear()} {builder.legal_name ?? builder.name}
      </Text>
    </View>
  )

  return (
    <Document title={`${builder.name} — Quote v${input.version}`} author={operator_contact.name ?? 'Humble House'}>
      {/* Cover + spec */}
      <Page size="LETTER" style={styles.page}>
        <Header />

        <View>
          <Text style={{ ...styles.small, letterSpacing: 2, textTransform: 'uppercase' }}>
            Quote v{input.version}
          </Text>
          <Text style={styles.coverTitle}>Prepared for {customerName}</Text>
          <Text style={styles.coverSub}>
            {platform.name} · {platform.chassis} · {platform.years}
          </Text>
        </View>

        {platform.hero_image_url ? (
          <Image src={platform.hero_image_url} style={styles.hero} />
        ) : (
          <View style={styles.hero} />
        )}

        <View style={styles.metaGrid}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Tier</Text>
            <Text style={styles.metaValue}>{tier.name}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Total</Text>
            <Text style={styles.metaAccent}>{money(input.price_cents, currency)}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Valid until</Text>
            <Text style={styles.metaValue}>{validUntil}</Text>
          </View>
          {terms.lead_time_copy ? (
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Lead time</Text>
              <Text style={styles.metaValue}>{terms.lead_time_copy}</Text>
            </View>
          ) : null}
        </View>

        {terms.quote_intro_copy ? <Text style={styles.intro}>{terms.quote_intro_copy}</Text> : null}

        <Text style={styles.h2}>Specification</Text>
        {grouped.length === 0 ? (
          <Text style={styles.small}>No options selected.</Text>
        ) : (
          grouped.map(([groupName, items]) => (
            <View key={groupName} wrap={false}>
              <Text style={styles.h3}>{groupName}</Text>
              {items.map((o, i) => {
                const qty = o.quantity ?? 1
                // Kit SKUs: price IS the kit price → do not multiply.
                const effectiveQty = o.sold_as_set ? 1 : qty
                // Cost-based builders split parts (× qty) from install
                // (× 1). Legacy pricing bundles everything into
                // price_cents_at_selection.
                const costBased = input.pricing_mode === 'cost_based'
                  && o.parts_sell_cents != null
                  && o.install_price_cents != null
                const extended = costBased
                  ? (o.parts_sell_cents as number) * effectiveQty + (o.install_price_cents as number)
                  : o.price_cents_at_selection * effectiveQty
                const qtyLabel = o.sold_as_set
                  ? 'Set of 4'
                  : qty === 5 ? 'Set of 5 incl. spare'
                  : qty === 4 ? 'Set of 4'
                  : null
                return (
                  <View key={i} style={styles.optionRow}>
                    {o.swatch_image_url ? (
                      <Image src={o.swatch_image_url} style={styles.swatch} />
                    ) : (
                      <View style={styles.swatch} />
                    )}
                    <View style={styles.optionTextWrap}>
                      <Text style={styles.optionName}>
                        {o.name}
                        {(() => {
                          const parts = [...(o.finish_names ?? [])]
                          if (o.finish_note) parts.push(o.finish_note)
                          return parts.length ? ` — ${parts.join(', ')}` : ''
                        })()}
                      </Text>
                      {qtyLabel ? (
                        <Text style={styles.optionCode}>
                          {qtyLabel}{o.code ? ` · ${o.code}` : ''}
                        </Text>
                      ) : o.code ? (
                        <Text style={styles.optionCode}>{o.code}</Text>
                      ) : null}
                    </View>
                    <Text style={styles.optionPrice}>
                      {o.included
                        ? 'Included'
                        : extended > 0
                          ? `+ ${money(extended, currency)}`
                          : 'Included'}
                    </Text>
                  </View>
                )
              })}
            </View>
          ))
        )}

        {input.pricing_mode === 'cost_based' && grouped.length > 0 && (
          <Text style={{ ...styles.small, marginTop: 10 }}>
            Prices include import shipping, duties and fitting.
          </Text>
        )}

        <Footer />
      </Page>

      {/* Pricing + process */}
      <Page size="LETTER" style={styles.page}>
        <Header />

        <Text style={styles.h2}>Pricing &amp; payment schedule</Text>

        <View style={{ ...styles.scheduleRow, borderBottom: `0.5 solid ${brand.color_text}44` }}>
          <Text style={{ ...styles.scheduleLabel, ...styles.metaLabel }}>Step</Text>
          <Text style={{ ...styles.scheduleTrigger, ...styles.metaLabel }}>Trigger</Text>
          <Text style={{ ...styles.scheduleAmount, ...styles.metaLabel }}>Amount</Text>
        </View>

        <View style={styles.scheduleRow}>
          <Text style={styles.scheduleLabel}>Reservation deposit</Text>
          <Text style={styles.scheduleTrigger}>Immediate</Text>
          <Text style={styles.scheduleAmount}>{money(terms.reservation_cents, currency)}</Text>
        </View>

        <View style={styles.subtotalRow}>
          <Text style={{ ...styles.scheduleLabel, ...styles.subtotalText }}>Balance after reservation</Text>
          <Text style={styles.scheduleTrigger}></Text>
          <Text style={{ ...styles.scheduleAmount, ...styles.subtotalText }}>
            {money(Math.max(0, input.price_cents - terms.reservation_cents), currency)}
          </Text>
        </View>

        {(() => {
          const balance = Math.max(0, input.price_cents - terms.reservation_cents)
          return (terms.payment_schedule ?? []).map((step, i) => {
            const dollars = Math.round(balance * (step.percent / 100))
            return (
              <View key={i} style={styles.scheduleRow}>
                <Text style={styles.scheduleLabel}>{step.label}</Text>
                <Text style={styles.scheduleTrigger}>{step.trigger}</Text>
                <Text style={styles.scheduleAmount}>{step.percent}% · {money(dollars, currency)}</Text>
              </View>
            )
          })
        })()}

        <View style={styles.totalStrip}>
          <View>
            <Text style={styles.totalLabel}>Build total</Text>
            <Text style={styles.totalCaption}>
              Scheduled payments total 100% of the balance after the reservation deposit.
            </Text>
          </View>
          <Text style={styles.totalAmount}>{money(input.price_cents, currency)}</Text>
        </View>

        {terms.warranty_text ? (
          <View style={{ marginTop: 20 }} wrap={false}>
            <Text style={styles.h3}>Warranty</Text>
            <Text style={styles.warranty}>{terms.warranty_text}</Text>
          </View>
        ) : null}

        <View style={{ marginTop: 22 }} wrap={false}>
          <Text style={styles.h2}>Process</Text>
          <View style={styles.processGrid}>
            {(brand.process_copy ?? []).map((s, i) => (
              <View key={i} style={styles.processCard}>
                <Text style={styles.processN}>{String(i + 1).padStart(2, '0')}</Text>
                <Text style={styles.processLabel}>{s.label}</Text>
                <Text style={styles.processCopy}>{s.copy}</Text>
              </View>
            ))}
          </View>
        </View>

        <Footer />
      </Page>
    </Document>
  )
}
