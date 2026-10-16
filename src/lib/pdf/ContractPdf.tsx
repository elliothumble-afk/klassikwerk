import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { ReactElement } from 'react'
import type { ContractPdfInput } from './types'
import { PAYMENT_SCHEDULE_SENTINEL, money } from './types'
import { resolveFamily } from './fonts'

/**
 * Substitute `{{merge_field}}` placeholders in the markdown body.
 */
function mergeMarkdown(markdown: string, fields: Record<string, string>): string {
  return markdown.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => fields[k] ?? `[${k}]`)
}

type Block =
  | { kind: 'h1' | 'h2' | 'h3'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'payment-schedule' }

/**
 * Minimal markdown → block list: headings, paragraphs, pipe tables,
 * and `-` lists. Mirrors the server-side helper the quote dropped.
 */
function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: Block[] = []
  let i = 0

  while (i < lines.length) {
    const raw = lines[i]
    const line = raw.trimEnd()

    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    if (h) {
      const n = h[1].length as 1 | 2 | 3
      const kind = (n === 1 ? 'h1' : n === 2 ? 'h2' : 'h3') as 'h1' | 'h2' | 'h3'
      out.push({ kind, text: h[2] })
      i += 1
      continue
    }

    if (line.startsWith('|')) {
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(lines[i].split('|').slice(1, -1).map(c => c.trim()))
        i += 1
      }
      if (rows.length >= 2) {
        const [header, _sep, ...body] = rows
        out.push({ kind: 'table', header, rows: body })
      }
      continue
    }

    if (/^-\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^-\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^-\s+/, ''))
        i += 1
      }
      out.push({ kind: 'ul', items })
      continue
    }

    if (line.trim() === '') { i += 1; continue }

    const buf: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith('|') &&
      !/^-\s+/.test(lines[i])
    ) {
      buf.push(lines[i])
      i += 1
    }
    const text = buf.join(' ').trim()
    if (text === PAYMENT_SCHEDULE_SENTINEL) out.push({ kind: 'payment-schedule' })
    else if (text) out.push({ kind: 'p', text })
  }

  return out
}

/**
 * Render `**bold**` inside a paragraph as separate Text nodes.
 */
function renderInline(text: string, keyPrefix: string, styles: ReturnType<typeof StyleSheet.create>): ReactElement[] {
  const parts: ReactElement[] = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  let idx = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(<Text key={`${keyPrefix}-t${idx++}`}>{text.slice(last, m.index)}</Text>)
    }
    parts.push(<Text key={`${keyPrefix}-b${idx++}`} style={styles.bold}>{m[1]}</Text>)
    last = m.index + m[0].length
  }
  if (last < text.length) {
    parts.push(<Text key={`${keyPrefix}-t${idx++}`}>{text.slice(last)}</Text>)
  }
  return parts
}

export function ContractPdf(input: ContractPdfInput) {
  const { brand, builder, operator_contact } = input
  const merged = mergeMarkdown(input.body_markdown, input.merge_fields)
  const blocks = parseBlocks(merged)
  const fontDisplay = resolveFamily(brand.font_display)
  const fontBody = resolveFamily(brand.font_body)

  const styles = StyleSheet.create({
    page: {
      backgroundColor: brand.color_bg,
      color: brand.color_text,
      fontFamily: fontBody,
      fontSize: 10.5,
      paddingTop: 48,
      paddingBottom: 54,
      paddingHorizontal: 56,
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
    docMeta: { marginBottom: 14 },
    docMetaLabel: {
      fontSize: 7,
      letterSpacing: 2,
      textTransform: 'uppercase',
      color: brand.color_text + '99',
    },
    h1: { fontFamily: fontDisplay, fontSize: 22, marginTop: 10, marginBottom: 10 },
    h2: { fontFamily: fontDisplay, fontSize: 14, marginTop: 16, marginBottom: 8 },
    h3: { fontFamily: fontDisplay, fontSize: 11, color: brand.color_accent, marginTop: 12, marginBottom: 4 },
    p: { marginBottom: 8 },
    bold: { fontWeight: 'semibold' },
    ul: { marginBottom: 8, marginLeft: 10 },
    li: { marginBottom: 2 },
    table: { marginBottom: 10 },
    tableRow: { flexDirection: 'row', borderBottom: `0.5 solid ${brand.color_text}22`, paddingVertical: 4 },
    tableHeader: {
      flexDirection: 'row',
      borderBottom: `0.75 solid ${brand.color_text}44`,
      paddingVertical: 4,
    },
    tableCell: { flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingRight: 6, fontSize: 10 },
    tableHeaderCell: {
      flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingRight: 6,
      fontSize: 8, textTransform: 'uppercase', letterSpacing: 1, color: brand.color_text + '99',
    },
    footer: {
      position: 'absolute',
      left: 56,
      right: 56,
      bottom: 24,
      flexDirection: 'row',
      justifyContent: 'space-between',
      borderTop: `0.5 solid ${brand.color_text}22`,
      paddingTop: 10,
    },
    footerContact: { fontSize: 8, color: brand.color_text + '99' },
    footerContactName: { fontSize: 8, color: brand.color_text, marginBottom: 2 },
    scheduleBlock: { marginTop: 4, marginBottom: 12 },
    scheduleHeader: {
      flexDirection: 'row',
      borderBottom: `0.75 solid ${brand.color_text}44`,
      paddingVertical: 4,
    },
    scheduleRow: {
      flexDirection: 'row',
      borderBottom: `0.5 solid ${brand.color_text}18`,
      paddingVertical: 6,
    },
    scheduleSubtotal: {
      flexDirection: 'row',
      borderBottom: `0.5 solid ${brand.color_text}22`,
      paddingVertical: 6,
      backgroundColor: '#00000008',
    },
    scheduleLabel: { flexGrow: 1, flexShrink: 1, flexBasis: 0, fontSize: 10 },
    scheduleTrigger: { width: 110, fontSize: 9, color: brand.color_text + '88' },
    scheduleAmount: { width: 130, textAlign: 'right', fontSize: 10 },
    scheduleLabelHeader: {
      flexGrow: 1, flexShrink: 1, flexBasis: 0,
      fontSize: 8, textTransform: 'uppercase', letterSpacing: 1, color: brand.color_text + '99',
    },
    scheduleTriggerHeader: {
      width: 110,
      fontSize: 8, textTransform: 'uppercase', letterSpacing: 1, color: brand.color_text + '99',
    },
    scheduleAmountHeader: {
      width: 130, textAlign: 'right',
      fontSize: 8, textTransform: 'uppercase', letterSpacing: 1, color: brand.color_text + '99',
    },
    subtotalText: { fontWeight: 'medium', color: brand.color_text + 'CC' },
  })

  const contact = [operator_contact.person, operator_contact.email, operator_contact.phone, operator_contact.website]
    .filter(Boolean)
    .join(' · ')

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
        <Text style={styles.footerContact}>{contact}</Text>
      </View>
      <Text style={styles.footerContact}>
        © {new Date().getFullYear()} {builder.legal_name ?? builder.name}
      </Text>
    </View>
  )

  const balanceCents = Math.max(0, input.price_cents - input.reservation_cents)
  const PaymentSchedule = ({ keyProp }: { keyProp: string }) => (
    <View key={keyProp} style={styles.scheduleBlock}>
      <View style={styles.scheduleHeader}>
        <Text style={styles.scheduleLabelHeader}>Step</Text>
        <Text style={styles.scheduleTriggerHeader}>Trigger</Text>
        <Text style={styles.scheduleAmountHeader}>Amount</Text>
      </View>
      <View style={styles.scheduleRow}>
        <Text style={styles.scheduleLabel}>Reservation deposit</Text>
        <Text style={styles.scheduleTrigger}>Immediate</Text>
        <Text style={styles.scheduleAmount}>{money(input.reservation_cents, input.currency)}</Text>
      </View>
      <View style={styles.scheduleSubtotal}>
        <Text style={{ ...styles.scheduleLabel, ...styles.subtotalText }}>Balance after reservation</Text>
        <Text style={styles.scheduleTrigger}></Text>
        <Text style={{ ...styles.scheduleAmount, ...styles.subtotalText }}>
          {money(balanceCents, input.currency)}
        </Text>
      </View>
      {(input.payment_schedule ?? []).map((step, j) => {
        const dollars = Math.round(balanceCents * (step.percent / 100))
        return (
          <View key={`${keyProp}-${j}`} style={styles.scheduleRow}>
            <Text style={styles.scheduleLabel}>{step.label}</Text>
            <Text style={styles.scheduleTrigger}>{step.trigger}</Text>
            <Text style={styles.scheduleAmount}>
              {step.percent}% · {money(dollars, input.currency)}
            </Text>
          </View>
        )
      })}
    </View>
  )

  const renderBlock = (b: Block, idx: number): ReactElement => {
    const key = `b${idx}`
    switch (b.kind) {
      case 'h1':
        return <Text key={key} style={styles.h1}>{b.text}</Text>
      case 'h2':
        return <Text key={key} style={styles.h2}>{b.text}</Text>
      case 'h3':
        return <Text key={key} style={styles.h3}>{b.text}</Text>
      case 'payment-schedule':
        return <PaymentSchedule key={key} keyProp={key} />
      case 'p':
        return (
          <Text key={key} style={styles.p}>
            {renderInline(b.text, key, styles)}
          </Text>
        )
      case 'ul':
        return (
          <View key={key} style={styles.ul}>
            {b.items.map((item, i) => (
              <Text key={`${key}-${i}`} style={styles.li}>
                • {renderInline(item, `${key}-${i}`, styles)}
              </Text>
            ))}
          </View>
        )
      case 'table':
        return (
          <View key={key} style={styles.table}>
            <View style={styles.tableHeader}>
              {b.header.map((h, i) => (
                <Text key={`${key}-h${i}`} style={styles.tableHeaderCell}>{h}</Text>
              ))}
            </View>
            {b.rows.map((row, i) => (
              <View key={`${key}-r${i}`} style={styles.tableRow}>
                {row.map((cell, j) => (
                  <Text key={`${key}-r${i}-c${j}`} style={styles.tableCell}>{cell}</Text>
                ))}
              </View>
            ))}
          </View>
        )
    }
  }

  return (
    <Document title={`${builder.name} — ${input.title} v${input.version}`} author={operator_contact.name ?? 'Humble House'}>
      <Page size="LETTER" style={styles.page}>
        <Header />
        <View style={styles.docMeta}>
          <Text style={styles.docMetaLabel}>{input.title} · v{input.version}</Text>
        </View>
        {blocks.map(renderBlock)}
        <Footer />
      </Page>
    </Document>
  )
}
