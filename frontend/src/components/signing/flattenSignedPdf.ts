import { degrees, EncryptedPDFError, PDFDocument, type PDFPage } from 'pdf-lib'
import type { SigningField } from './client'

export const isImageField = (field: Pick<SigningField, 'type'>) => field.type === 'signature' || field.type === 'initials'

/**
 * Renders a text value as a PNG sized to its field. Drawing text as an image keeps any script
 * (including Vietnamese diacritics) intact without embedding a font in the PDF.
 */
export function renderTextPng(text: string, widthPt: number, heightPt: number): string {
  const scale = 4
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(widthPt * scale))
  canvas.height = Math.max(1, Math.round(heightPt * scale))
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Your browser cannot render text fields.')
  }
  const padding = Math.min(canvas.height * 0.15, 3 * scale)
  let size = canvas.height * 0.7
  const font = (value: number) => `${value}px Helvetica, Arial, sans-serif`
  context.font = font(size)
  const available = canvas.width - padding * 2
  const measured = context.measureText(text).width
  if (measured > available) {
    size = Math.max(4 * scale, size * available / measured)
    context.font = font(size)
  }
  context.fillStyle = '#111111'
  context.textBaseline = 'middle'
  context.fillText(text, padding, canvas.height / 2, available)
  return canvas.toDataURL('image/png')
}

/** Maps a point on the displayed (rotated) page, as fractions from its top-left corner, to PDF user space. */
function toPdfPoint(page: PDFPage, rotation: number, u: number, v: number) {
  const { x, y, width, height } = page.getCropBox()
  switch (rotation) {
    case 90:
      return { x: x + v * width, y: y + u * height }
    case 180:
      return { x: x + (1 - u) * width, y: y + v * height }
    case 270:
      return { x: x + (1 - v) * width, y: y + (1 - u) * height }
    default:
      return { x: x + u * width, y: y + (1 - v) * height }
  }
}

export function displayedSize(page: PDFPage) {
  const rotation = ((page.getRotation().angle % 360) + 360) % 360
  const { width, height } = page.getCropBox()
  return rotation % 180 === 0 ? { width, height, rotation } : { width: height, height: width, rotation }
}

/**
 * Draws every field value onto the original PDF and returns the flattened document.
 * `skipEmpty` leaves out fields without a value, for previewing a partly completed request.
 */
export async function flattenSignedPdf(original: ArrayBuffer, fields: SigningField[], { skipEmpty = false } = {}): Promise<Uint8Array> {
  let document: PDFDocument
  try {
    document = await PDFDocument.load(original)
  } catch (cause) {
    if (cause instanceof EncryptedPDFError) {
      throw new Error('This PDF is password protected or encrypted, so it cannot be signed in the app.')
    }
    throw cause
  }
  const pages = document.getPages()
  for (const field of fields) {
    const page = pages[field.page - 1]
    if (skipEmpty && page && !field.value) {
      continue
    }
    if (!page || !field.value) {
      throw new Error('A field is outside the document or has no value. Review the fields and try again.')
    }
    const { width: pageWidth, height: pageHeight, rotation } = displayedSize(page)
    const boxWidth = field.width * pageWidth
    const boxHeight = field.height * pageHeight
    const png = isImageField(field) ? field.value : renderTextPng(field.value, boxWidth, boxHeight)
    const image = await document.embedPng(png)
    // Fit the image inside the field without distorting it, centred in the box.
    const scale = Math.min(boxWidth / image.width, boxHeight / image.height)
    const drawWidth = image.width * scale
    const drawHeight = image.height * scale
    const left = field.x + (boxWidth - drawWidth) / 2 / pageWidth
    const bottom = field.y + field.height - (boxHeight - drawHeight) / 2 / pageHeight
    const anchor = toPdfPoint(page, rotation, left, bottom)
    // Counter-rotate so the value reads upright on a rotated page.
    page.drawImage(image, { x: anchor.x, y: anchor.y, width: drawWidth, height: drawHeight, rotate: degrees(rotation) })
  }
  return document.save()
}
