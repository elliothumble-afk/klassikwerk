// Shared PDF helpers: flatten markdown → lines, lay them out on US Letter.
// Reused by render-contract and render-quote.

// deno-lint-ignore-file no-explicit-any
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1'

export interface Line { text: string; size: number; weight: 'regular' | 'bold'; indent: number }

export function mergeFields(markdown: string, fields: Record<string, string>): string {
  return markdown.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => fields[k] ?? `[${k}]`)
}

export function flattenMarkdown(md: string): Line[] {
  const out: Line[] = []
  const paragraphs = md.replace(/\r\n/g, '\n').split(/\n/)
  for (const raw of paragraphs) {
    const line = raw.trimEnd()
    if (line.trim() === '') { out.push({ text: '', size: 11, weight: 'regular', indent: 0 }); continue }

    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    if (h) {
      const lvl = h[1].length
      out.push({ text: h[2], size: lvl === 1 ? 20 : lvl === 2 ? 15 : 13, weight: 'bold', indent: 0 })
      continue
    }

    if (line.startsWith('|')) {
      const cells = line.split('|').slice(1, -1).map(c => c.trim())
      if (cells.every(c => /^-{2,}$/.test(c))) continue
      out.push({ text: cells.join('   '), size: 10, weight: 'regular', indent: 10 })
      continue
    }

    if (/^-\s+/.test(line)) {
      out.push({ text: '• ' + line.replace(/^-\s+/, ''), size: 11, weight: 'regular', indent: 12 })
      continue
    }

    const b = /^\*\*(.+)\*\*$/.exec(line)
    if (b) { out.push({ text: b[1], size: 11, weight: 'bold', indent: 0 }); continue }
    const stripped = line.replace(/\*\*(.+?)\*\*/g, '$1')
    out.push({ text: stripped, size: 11, weight: 'regular', indent: 0 })
  }
  return out
}

export async function renderMarkdownPdf(title: string, body: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const pageWidth = 612
  const pageHeight = 792
  const margin = 54
  const maxWidth = pageWidth - margin * 2
  let page = doc.addPage([pageWidth, pageHeight])
  let y = pageHeight - margin

  const draw = (text: string, size: number, font: any, indent: number) => {
    const words = text.split(' ')
    let line = ''
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w
      if (font.widthOfTextAtSize(candidate, size) > maxWidth - indent) {
        page.drawText(line, { x: margin + indent, y, size, font, color: rgb(0.1, 0.1, 0.1) })
        y -= size + 4
        if (y < margin) { page = doc.addPage([pageWidth, pageHeight]); y = pageHeight - margin }
        line = w
      } else line = candidate
    }
    if (line) {
      page.drawText(line, { x: margin + indent, y, size, font, color: rgb(0.1, 0.1, 0.1) })
      y -= size + 4
      if (y < margin) { page = doc.addPage([pageWidth, pageHeight]); y = pageHeight - margin }
    }
  }

  draw(title, 24, bold, 0)
  y -= 10

  for (const l of flattenMarkdown(body)) {
    if (l.text === '') { y -= 6; continue }
    draw(l.text, l.size, l.weight === 'bold' ? bold : regular, l.indent)
  }

  return await doc.save()
}
