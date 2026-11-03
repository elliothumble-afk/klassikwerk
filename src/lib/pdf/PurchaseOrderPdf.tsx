import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { resolveFamily } from './fonts'

export interface PoLineInput {
  sku: string | null
  description: string
  qty: number
  unit_cost_cents: number
  finish: string | null
  note: string | null  // "CONFIRM PART NUMBER" when kit_sku_placeholder was true
}

export interface PurchaseOrderPdfInput {
  po_number: string
  created_at: string
  status: 'draft' | 'sent' | 'confirmed' | 'received'
  currency: string
  subtotal_cents: number
  supplier: {
    name: string
    email: string | null
    cc_email: string | null
    address: string | null
    order_notes: string | null
    lead_time_days: number | null
  }
  ship_to: {
    name: string
    address: string
    phone: string | null
    email: string | null
  }
  brand: {
    logo_url: string | null
    wordmark_text: string | null
    color_accent: string
    font_display: string
    font_body: string
  }
  vehicle: {
    platform: string
    year: string | null
    vin: string | null
  }
  build_number: string
  customer_name: string
  lines: PoLineInput[]
}

function currencyFmt(cents: number, currency: string): string {
  const n = (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const sym = currency.toUpperCase() === 'GBP' ? '£' : currency.toUpperCase() === 'EUR' ? '€' : '$'
  return `${sym}${n}`
}

export function PurchaseOrderPdf(input: PurchaseOrderPdfInput) {
  const display = resolveFamily(input.brand.font_display)
  const body = resolveFamily(input.brand.font_body)

  const INK = '#1F2420'
  const MUTED = '#5F6560'
  const DIVIDER = '#D9D4C7'
  const RED = '#B5341F'

  const s = StyleSheet.create({
    page: { backgroundColor: '#FFFFFF', color: INK, fontFamily: body, padding: 48 },
    label: { fontFamily: 'Helvetica-Bold', fontSize: 8, color: MUTED, letterSpacing: 1 },
    h1: { fontFamily: display, fontSize: 24, color: INK, lineHeight: 1.1 },
    body: { fontFamily: body, fontSize: 10, color: INK, lineHeight: 1.35 },
    small: { fontFamily: body, fontSize: 8, color: MUTED, lineHeight: 1.3 },
  })

  const createdDate = new Date(input.created_at).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })

  return (
    <Document title={`Purchase Order ${input.po_number}`} author={input.ship_to.name}>
      <Page size="LETTER" style={s.page}>
        {/* Header: brand on left, PO identity on right. */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View>
            {input.brand.logo_url
              ? <Image src={input.brand.logo_url} style={{ width: 150, height: 42, objectFit: 'contain' }} />
              : <Text style={{ fontFamily: display, fontSize: 20 }}>{input.brand.wordmark_text ?? input.ship_to.name}</Text>}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.label}>PURCHASE ORDER</Text>
            <Text style={[s.h1, { marginTop: 4 }]}>{input.po_number}</Text>
            <Text style={[s.small, { marginTop: 2 }]}>{createdDate}</Text>
          </View>
        </View>

        {/* Supplier / Ship-to blocks. */}
        <View style={{ flexDirection: 'row', marginTop: 32, gap: 24 }}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>SUPPLIER</Text>
            <Text style={[s.body, { marginTop: 4, fontFamily: 'Helvetica-Bold' }]}>{input.supplier.name}</Text>
            {input.supplier.address && <Text style={s.body}>{input.supplier.address}</Text>}
            {input.supplier.email && <Text style={s.body}>{input.supplier.email}</Text>}
            {input.supplier.cc_email && <Text style={s.small}>cc: {input.supplier.cc_email}</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>SHIP TO</Text>
            <Text style={[s.body, { marginTop: 4, fontFamily: 'Helvetica-Bold' }]}>{input.ship_to.name}</Text>
            <Text style={s.body}>{input.ship_to.address}</Text>
            {input.ship_to.phone && <Text style={s.body}>{input.ship_to.phone}</Text>}
            {input.ship_to.email && <Text style={s.body}>{input.ship_to.email}</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>VEHICLE</Text>
            <Text style={[s.body, { marginTop: 4, fontFamily: 'Helvetica-Bold' }]}>{input.vehicle.platform}</Text>
            {input.vehicle.year && <Text style={s.body}>Year {input.vehicle.year}</Text>}
            {input.vehicle.vin && <Text style={s.body}>VIN {input.vehicle.vin}</Text>}
            <Text style={[s.small, { marginTop: 4 }]}>Build {input.build_number}</Text>
            <Text style={s.small}>{input.customer_name}</Text>
          </View>
        </View>

        {/* Lines table.
            SKU widened to 130 so Kahn's long SKUs
            (CTCDEF20RIGIDWHEELCOVER / BCWLD2AW-110-VC-Kit) wrap
            inside the column instead of bleeding into Description. */}
        <View style={{ marginTop: 32 }}>
          <View style={{ flexDirection: 'row', borderBottom: `1 solid ${INK}`, paddingBottom: 4 }}>
            <Text style={[s.label, { width: 130 }]}>SKU</Text>
            <Text style={[s.label, { flex: 2 }]}>Description</Text>
            <Text style={[s.label, { flex: 1 }]}>Finish / variant</Text>
            <Text style={[s.label, { width: 30, textAlign: 'right' }]}>Qty</Text>
            <Text style={[s.label, { width: 70, textAlign: 'right' }]}>Unit</Text>
            <Text style={[s.label, { width: 80, textAlign: 'right' }]}>Total</Text>
          </View>
          {input.lines.map((l, i) => {
            const total = l.qty * l.unit_cost_cents
            const flag = l.note === 'CONFIRM PART NUMBER'
            return (
              <View key={i} style={{
                flexDirection: 'row', paddingVertical: 6,
                borderBottom: `0.5 solid ${DIVIDER}`, alignItems: 'flex-start',
              }}>
                <Text style={[s.small, {
                  width: 130, paddingRight: 6,
                  color: flag ? RED : INK,
                }]}>
                  {flag ? 'CONFIRM PART NUMBER' : (l.sku ?? '—')}
                </Text>
                <Text style={[s.body, { flex: 2, paddingRight: 6 }]}>{l.description}</Text>
                <Text style={[s.small, { flex: 1, paddingRight: 6 }]}>{l.finish ?? ''}</Text>
                <Text style={[s.body, { width: 30, textAlign: 'right' }]}>{l.qty}</Text>
                <Text style={[s.body, { width: 70, textAlign: 'right' }]}>{currencyFmt(l.unit_cost_cents, input.currency)}</Text>
                <Text style={[s.body, { width: 80, textAlign: 'right' }]}>{currencyFmt(total, input.currency)}</Text>
              </View>
            )
          })}
          {input.lines.length === 0 && (
            <Text style={[s.small, { paddingTop: 8 }]}>No lines on this order.</Text>
          )}
          {/* Subtotal. */}
          <View style={{ flexDirection: 'row', marginTop: 10, paddingTop: 8, borderTop: `1 solid ${INK}` }}>
            <Text style={[s.body, { flex: 1 }]} />
            <Text style={[s.body, { width: 110, textAlign: 'right', fontFamily: 'Helvetica-Bold' }]}>Subtotal</Text>
            <Text style={[s.body, { width: 100, textAlign: 'right', fontFamily: 'Helvetica-Bold' }]}>
              {currencyFmt(input.subtotal_cents, input.currency)}
            </Text>
          </View>
        </View>

        {/* Notes. */}
        <View style={{ marginTop: 24 }} wrap={false}>
          {input.supplier.order_notes && (
            <>
              <Text style={s.label}>NOTES</Text>
              <Text style={[s.body, { marginTop: 4 }]}>{input.supplier.order_notes}</Text>
            </>
          )}
          <Text style={[s.body, { marginTop: 12 }]}>
            Please confirm availability and lead time.
          </Text>
          {input.supplier.lead_time_days != null && (
            <Text style={s.small}>Expected lead time: {input.supplier.lead_time_days} days.</Text>
          )}
        </View>

        {/* Footer. */}
        <View style={{ position: 'absolute', left: 48, right: 48, bottom: 36 }}>
          <View style={{ borderTop: `0.5 solid ${DIVIDER}`, paddingTop: 8, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={s.small}>{input.ship_to.name}</Text>
            <Text style={s.small}>{input.po_number} · {input.status.toUpperCase()}</Text>
          </View>
        </View>
      </Page>
    </Document>
  )
}
