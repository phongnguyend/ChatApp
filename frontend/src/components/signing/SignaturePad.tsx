import { useEffect, useRef, useState } from 'react'
import { Check, CopyCheck, Eraser, History, Upload } from 'lucide-react'
import { ErrorBanner, Modal } from './ui'

const INK = '#1a2b6d'

/** Normalize imported images to the PNG format and size accepted by signing fields. */
async function signatureImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a PNG, JPEG, or WebP image.')
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Choose an image smaller than 5 MB.')
  }
  const image = await createImageBitmap(file)
  try {
    const output = document.createElement('canvas')
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height))
    output.width = Math.max(1, Math.round(image.width * scale))
    output.height = Math.max(1, Math.round(image.height * scale))
    const context = output.getContext('2d')
    if (!context) {
      throw new Error('Your browser cannot import signature images.')
    }
    while (true) {
      context.drawImage(image, 0, 0, output.width, output.height)
      const png = trimmedPng(output)
      if (!png) {
        throw new Error('This image is fully transparent. Choose a visible signature.')
      }
      if (png.length <= 400_000) {
        return png
      }
      if (Math.max(output.width, output.height) <= 200) {
        throw new Error('This image is too large to save. Choose a simpler signature image.')
      }
      output.width = Math.max(1, Math.floor(output.width * 0.75))
      output.height = Math.max(1, Math.floor(output.height * 0.75))
    }
  } finally {
    image.close()
  }
}

/** Crops the transparent margin so the drawn strokes fill the field when placed on the PDF. */
function trimmedPng(canvas: HTMLCanvasElement): string | null {
  const context = canvas.getContext('2d')
  if (!context) {
    return null
  }
  const { width, height } = canvas
  const pixels = context.getImageData(0, 0, width, height).data
  let top = height
  let left = width
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] > 0) {
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
        left = Math.min(left, x)
        right = Math.max(right, x)
      }
    }
  }
  if (right < 0) {
    return null
  }
  const margin = 8
  left = Math.max(0, left - margin)
  top = Math.max(0, top - margin)
  right = Math.min(width - 1, right + margin)
  bottom = Math.min(height - 1, bottom + margin)
  const output = document.createElement('canvas')
  output.width = right - left + 1
  output.height = bottom - top + 1
  output.getContext('2d')?.drawImage(canvas, left, top, output.width, output.height, 0, 0, output.width, output.height)
  return output.toDataURL('image/png')
}

export function SignaturePad({ title, previous, emptyCount, onApply, onClose }: {
  title: string
  /** A signature already entered in this request that can be reused. */
  previous: string | null
  /** How many other fields of this type are still unsigned. */
  emptyCount: number
  onApply: (png: string, applyToAll: boolean) => void
  onClose: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [empty, setEmpty] = useState(true)
  const fileInput = useRef<HTMLInputElement>(null)
  const importVersion = useRef(0)
  const [imported, setImported] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const canApply = !importing && (!!imported || !empty)

  useEffect(() => () => {
    importVersion.current++
  }, [])

  const importFile = async (files: File[]) => {
    const version = ++importVersion.current
    setError(null)
    setImporting(true)
    try {
      if (files.length !== 1) {
        throw new Error('Choose one signature image at a time.')
      }
      const png = await signatureImage(files[0])
      if (version === importVersion.current) {
        last.current = null
        setImported(png)
      }
    } catch (cause) {
      if (version === importVersion.current) {
        setError(cause instanceof Error && cause.name !== 'InvalidStateError'
          ? cause.message : 'Could not read this image. Choose a valid PNG, JPEG, or WebP file.')
      }
    } finally {
      if (version === importVersion.current) {
        setImporting(false)
      }
    }
  }

  useEffect(() => {
    const element = canvas.current
    if (!element) {
      return
    }
    // The dialog opens after this effect runs, so size the bitmap once the canvas has a layout size.
    // Resizing a canvas clears it, which is why a resize also resets the drawing.
    const observer = new ResizeObserver(([entry]) => {
      const ratio = window.devicePixelRatio || 1
      const width = Math.round(entry.contentRect.width * ratio)
      const height = Math.round(entry.contentRect.height * ratio)
      if (width === 0 || height === 0 || (element.width === width && element.height === height)) {
        return
      }
      element.width = width
      element.height = height
      const context = element.getContext('2d')
      if (context) {
        context.scale(ratio, ratio)
        context.lineCap = 'round'
        context.lineJoin = 'round'
        context.strokeStyle = INK
        context.fillStyle = INK
        context.lineWidth = 2.6
      }
      setEmpty(true)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const clear = () => {
    importVersion.current++
    setImporting(false)
    setImported(null)
    setError(null)
    last.current = null
    const element = canvas.current
    element?.getContext('2d')?.clearRect(0, 0, element.width, element.height)
    setEmpty(true)
  }

  const apply = (applyToAll: boolean) => {
    const png = imported ?? (canvas.current ? trimmedPng(canvas.current) : null)
    if (png) {
      onApply(png, applyToAll)
    }
  }

  return <Modal open title={title} className="signature-pad-modal" onClose={onClose}>
    <div className={`signature-pad-input${dragging ? ' is-dragging' : ''}`}
      onPaste={event => {
        const files = Array.from(event.clipboardData.files)
        if (files.length > 0) {
          event.preventDefault()
          event.stopPropagation()
          void importFile(files)
        }
      }}
      onDragOver={event => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setDragging(true)
        }
      }}
      onDragLeave={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragging(false)
        }
      }}
      onDrop={event => {
        event.preventDefault()
        event.stopPropagation()
        setDragging(false)
        void importFile(Array.from(event.dataTransfer.files))
      }}>
    <p className="signature-pad-help">Draw below, upload or drop an image, or paste with Ctrl+V / ⌘V.</p>
    <div className="row signature-pad-upload">
      <button type="button" autoFocus onClick={() => fileInput.current?.click()} disabled={importing}><Upload size={14} />Upload image</button>
      <span>PNG, JPEG, or WebP · up to 5 MB</span>
      <input ref={fileInput} type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label="Upload signature image"
        onChange={event => {
          const files = Array.from(event.currentTarget.files ?? [])
          event.currentTarget.value = ''
          if (files.length > 0) {
            void importFile(files)
          }
        }} />
    </div>
    {importing && <p role="status">Preparing image…</p>}
    {error && <ErrorBanner message={error} />}
    {imported && <div className="signature-pad-preview" tabIndex={0} aria-label="Imported signature preview. Paste or drop an image to replace it.">
      <img src={imported} alt="Signature to apply" />
    </div>}
    <div className="signature-pad-surface" hidden={!!imported}>
    <canvas ref={canvas} className="signature-pad-canvas" tabIndex={0} aria-label="Signature drawing area"
      onPointerDown={event => {
        event.currentTarget.setPointerCapture(event.pointerId)
        const start = point(event)
        last.current = start
        const context = event.currentTarget.getContext('2d')
        if (context) {
          context.beginPath()
          context.arc(start.x, start.y, context.lineWidth / 2, 0, Math.PI * 2)
          context.fill()
        }
        setEmpty(false)
      }}
      onPointerMove={event => {
        if (!last.current) {
          return
        }
        const context = event.currentTarget.getContext('2d')
        const next = point(event)
        if (context) {
          const middle = { x: (last.current.x + next.x) / 2, y: (last.current.y + next.y) / 2 }
          context.beginPath()
          context.moveTo(last.current.x, last.current.y)
          context.quadraticCurveTo(last.current.x, last.current.y, middle.x, middle.y)
          context.lineTo(next.x, next.y)
          context.stroke()
        }
        last.current = next
      }}
      onPointerUp={() => {
        last.current = null
      }}
      onPointerCancel={() => {
        last.current = null
      }} />
    <div className="signature-pad-baseline" aria-hidden="true" />
    </div>
    <div className="row signature-pad-actions">
      <button type="button" onClick={clear} disabled={empty && !imported && !importing}><Eraser size={14} />Clear</button>
      {previous && <button type="button" disabled={importing} onClick={() => onApply(previous, false)}><History size={14} />Use previous</button>}
      <span className="signature-pad-spacer" />
      <button type="button" className="ghost" onClick={onClose}>Cancel</button>
      {emptyCount > 0 && <button type="button" disabled={!canApply} onClick={() => apply(true)}
        title={`Also apply to ${emptyCount} other unsigned field${emptyCount === 1 ? '' : 's'}`}>
        <CopyCheck size={14} />Apply to all ({emptyCount + 1})
      </button>}
      <button type="button" className="primary" disabled={!canApply} onClick={() => apply(false)}><Check size={14} />Apply</button>
    </div>
    </div>
  </Modal>
}
