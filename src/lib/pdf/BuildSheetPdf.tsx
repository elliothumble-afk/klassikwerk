import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { resolveFamily } from './fonts'

export interface BuildSheetLine {
  section: string | null
  name: string
  sku: string | null
  qty: number
  finishes: string | null
  finish_note: string | null
  instruction: string | null
  install_hours: number | null
  paint_hours: number | null
  materials_cents: number | null
  size: string | null
  thumbnail_url: string | null
}

export interface BuildSheetPdfInput {
  build_number: string
  customer_name: string
  vehicle: {
    platform: string
    year: string | null
    colour: string | null
    vin: string | null
    mileage_in: string | null
  }
  key_dates: Array<{ label: string; date: string | null }>
  hh_contact: { name: string | null; phone: string | null; email: string | null }
  instructions_markdown: string | null
  brand: {
    logo_url: string | null
    wordmark_text: string | null
    font_display: string
    font_body: string
  }
  lines: BuildSheetLine[]
  version: number
}

// Trivial markdown renderer: splits into blocks, converts **bold**
// and *italic* inline. No lists / headings beyond #, ##, ### — enough
// for installer notes typed by the ops user.
function renderMarkdown(md: string, display: string, body: string) {
  const INK = '#1F2420'
  // Split paragraphs on blank lines, then let the renderer promote a
  // leading heading line out of its block so a "## Priority\n- Confirm…"
  // block renders as the heading PLUS the bullets, not just the heading.
  const rawBlocks = md.split(/\n{2,}/).map(b => b.trim()).filter(Boolean)
  const blocks: string[] = []
  for (const b of rawBlocks) {
    const headingMatch = /^(#{1,3}\s+.+)(?:\n([\s\S]*))?$/.exec(b)
    if (headingMatch) {
      blocks.push(headingMatch[1])
      if (headingMatch[2] && headingMatch[2].trim()) blocks.push(headingMatch[2].trim())
    } else {
      blocks.push(b)
    }
  }
  const renderInline = (text: string): React.ReactNode[] => {
    // Split on **bold** and *italic* preserving tokens.
    const parts: React.ReactNode[] = []
    const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g
    let last = 0
    let m: RegExpExecArray | null
    let i = 0
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parts.push(text.slice(last, m.index))
      if (m[1]) parts.push(<Text key={i++} style={{ fontFamily: 'Helvetica-Bold' }}>{m[1]}</Text>)
      else if (m[2]) parts.push(<Text key={i++} style={{ fontFamily: 'Helvetica-Oblique' }}>{m[2]}</Text>)
      last = re.lastIndex
    }
    if (last < text.length) parts.push(text.slice(last))
    return parts
  }
  return blocks.map((b, i) => {
    const h1 = /^#\s+(.+)/.exec(b)
    const h2 = /^##\s+(.+)/.exec(b)
    const h3 = /^###\s+(.+)/.exec(b)
    const bullets = /^\s*[-*]\s+/.test(b)
    if (h3) return <Text key={i} style={{ fontFamily: display, fontSize: 11, color: INK, marginTop: 8, marginBottom: 2 }}>{h3[1]}</Text>
    if (h2) return <Text key={i} style={{ fontFamily: display, fontSize: 12, color: INK, marginTop: 10, marginBottom: 2 }}>{h2[1]}</Text>
    if (h1) return <Text key={i} style={{ fontFamily: display, fontSize: 14, color: INK, marginTop: 10, marginBottom: 4 }}>{h1[1]}</Text>
    if (bullets) {
      const items = b.split('\n').map(l => l.replace(/^\s*[-*]\s+/, '').trim()).filter(Boolean)
      return (
        <View key={i} style={{ marginTop: 4, marginBottom: 4 }}>
          {items.map((it, j) => (
            <View key={j} style={{ flexDirection: 'row', marginBottom: 2 }}>
              <Text style={{ fontFamily: body, fontSize: 9, color: INK, width: 10 }}>•</Text>
              <Text style={{ fontFamily: body, fontSize: 9, color: INK, flex: 1 }}>{renderInline(it)}</Text>
            </View>
          ))}
        </View>
      )
    }
    return <Text key={i} style={{ fontFamily: body, fontSize: 9, color: INK, marginBottom: 4, lineHeight: 1.4 }}>{renderInline(b)}</Text>
  })
}

function money(cents: number | null | undefined): string {
  if (cents == null) return '—'
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

export function BuildSheetPdf(input: BuildSheetPdfInput) {
  const display = resolveFamily(input.brand.font_display)
  const body = resolveFamily(input.brand.font_body)

  const INK = '#1F2420'
  const MUTED = '#5F6560'
  const DIVIDER = '#D9D4C7'
  const BG = '#F8F6EE'

  const s = StyleSheet.create({
    page: { backgroundColor: '#FFFFFF', color: INK, fontFamily: body, padding: 40, paddingBottom: 60 },
    label: { fontFamily: 'Helvetica-Bold', fontSize: 7, color: MUTED, letterSpacing: 1 },
    small: { fontFamily: body, fontSize: 8, color: MUTED, lineHeight: 1.3 },
    body: { fontFamily: body, fontSize: 9, color: INK, lineHeight: 1.4 },
    h1: { fontFamily: display, fontSize: 22, color: INK, lineHeight: 1.1 },
    h2: { fontFamily: display, fontSize: 14, color: INK, lineHeight: 1.2 },
  })

  // Group lines by section, preserving original order.
  const sectionsOrder: string[] = []
  const sectionsMap = new Map<string, BuildSheetLine[]>()
  for (const l of input.lines) {
    const key = l.section ?? 'Other'
    if (!sectionsMap.has(key)) {
      sectionsMap.set(key, [])
      sectionsOrder.push(key)
    }
    sectionsMap.get(key)!.push(l)
  }

  const checkbox = (
    <View style={{ width: 10, height: 10, borderWidth: 0.75, borderColor: INK, marginRight: 3 }} />
  )

  return (
    <Document title={`Build Sheet ${input.build_number}`}>
      <Page size="LETTER" style={s.page}>
        {/* Header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flexShrink: 1 }}>
            {input.brand.logo_url
              ? <Image src={input.brand.logo_url} style={{ width: 120, height: 36, objectFit: 'contain' }} />
              : <Text style={{ fontFamily: display, fontSize: 18 }}>{input.brand.wordmark_text ?? ''}</Text>}
            <Text style={[s.label, { marginTop: 10 }]}>BUILD SHEET</Text>
            <Text style={[s.h1, { marginTop: 2 }]}>{input.build_number}</Text>
            <Text style={[s.body, { marginTop: 2 }]}>{input.customer_name}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.label}>VEHICLE</Text>
            <Text style={[s.body, { marginTop: 2, fontFamily: 'Helvetica-Bold' }]}>{input.vehicle.platform}</Text>
            {input.vehicle.year && <Text style={s.body}>Year {input.vehicle.year}</Text>}
            {input.vehicle.colour && <Text style={s.body}>{input.vehicle.colour}</Text>}
            {input.vehicle.vin && <Text style={s.small}>VIN {input.vehicle.vin}</Text>}
            {input.vehicle.mileage_in && <Text style={s.small}>Mileage in: {input.vehicle.mileage_in}</Text>}
          </View>
        </View>

        {/* Key dates + HH contact strip */}
        <View style={{ flexDirection: 'row', marginTop: 16, backgroundColor: BG, padding: 10, gap: 20 }}>
          <View style={{ flex: 2 }}>
            <Text style={s.label}>KEY DATES</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4, gap: 12 }}>
              {input.key_dates.map((kd, i) => (
                <View key={i} style={{ marginRight: 10 }}>
                  <Text style={s.small}>{kd.label}</Text>
                  <Text style={s.body}>{kd.date ?? '—'}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>HH CONTACT</Text>
            {input.hh_contact.name && <Text style={s.body}>{input.hh_contact.name}</Text>}
            {input.hh_contact.phone && <Text style={s.small}>{input.hh_contact.phone}</Text>}
            {input.hh_contact.email && <Text style={s.small}>{input.hh_contact.email}</Text>}
          </View>
        </View>

        {/* Instructions markdown */}
        {input.instructions_markdown && (
          <View style={{ marginTop: 16 }}>
            <Text style={s.label}>INSTRUCTIONS</Text>
            <View style={{ marginTop: 4 }}>
              {renderMarkdown(input.instructions_markdown, display, body)}
            </View>
          </View>
        )}

        {/* Lines per section */}
        {sectionsOrder.map((sec) => (
          <View key={sec} style={{ marginTop: 16 }} wrap>
            <Text style={[s.h2, { borderBottom: `0.5 solid ${INK}`, paddingBottom: 3 }]}>{sec}</Text>
            {sectionsMap.get(sec)!.map((l, i) => (
              <View key={i} style={{
                flexDirection: 'row',
                paddingVertical: 8,
                borderBottom: `0.5 solid ${DIVIDER}`,
                alignItems: 'flex-start',
              }} wrap={false}>
                {/* Thumbnail */}
                <View style={{ width: 56, marginRight: 10 }}>
                  {l.thumbnail_url
                    ? <Image src={l.thumbnail_url} style={{ width: 56, height: 42, objectFit: 'cover' }} />
                    : <View style={{ width: 56, height: 42, backgroundColor: DIVIDER }} />}
                </View>
                {/* Name + meta */}
                <View style={{ flex: 2.3 }}>
                  <Text style={[s.body, { fontFamily: 'Helvetica-Bold' }]}>{l.name}{l.size ? ` (${l.size})` : ''}</Text>
                  <Text style={s.small}>SKU {l.sku ?? '—'} · Qty {l.qty}</Text>
                  {l.finishes && <Text style={s.small}>{l.finishes}</Text>}
                  {l.finish_note && <Text style={s.small}>Finish note: {l.finish_note}</Text>}
                  {l.instruction && (
                    <Text style={[s.body, { marginTop: 3, fontFamily: 'Helvetica-Oblique' }]}>
                      Note: {l.instruction}
                    </Text>
                  )}
                </View>
                {/* Hours + materials */}
                <View style={{ flex: 1 }}>
                  <Text style={s.small}>Install: {l.install_hours ?? '—'} h</Text>
                  <Text style={s.small}>Paint: {l.paint_hours ?? '—'} h</Text>
                  <Text style={s.small}>Materials: {money(l.materials_cents)}</Text>
                </View>
                {/* Checkboxes */}
                <View style={{ width: 150, alignItems: 'flex-end' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {checkbox}<Text style={s.small}>Received</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                    {checkbox}<Text style={s.small}>Fitted</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                    {checkbox}<Text style={s.small}>Checked</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        ))}

        {/* Sign-off footer */}
        <View style={{ marginTop: 28 }} wrap={false}>
          <View style={{ flexDirection: 'row', gap: 32 }}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>INSTALLER SIGN-OFF</Text>
              <View style={{ height: 48, borderBottom: `0.5 solid ${INK}`, marginTop: 24 }} />
              <View style={{ flexDirection: 'row', marginTop: 4, gap: 10 }}>
                <Text style={s.small}>Name / Signature</Text>
                <Text style={s.small}>Date</Text>
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>HH INSPECTOR SIGN-OFF</Text>
              <View style={{ height: 48, borderBottom: `0.5 solid ${INK}`, marginTop: 24 }} />
              <View style={{ flexDirection: 'row', marginTop: 4, gap: 10 }}>
                <Text style={s.small}>Name / Signature</Text>
                <Text style={s.small}>Date</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Page footer */}
        <View fixed style={{ position: 'absolute', left: 40, right: 40, bottom: 24 }}>
          <View style={{ borderTop: `0.5 solid ${DIVIDER}`, paddingTop: 6, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={s.small}>{input.build_number} · {input.customer_name}</Text>
            <Text style={s.small}>Build sheet v{input.version}</Text>
          </View>
        </View>
      </Page>
    </Document>
  )
}
