import { useEffect, useRef, useState } from 'react'
import { Check, CopyCheck, Eraser, History } from 'lucide-react'
import { Modal } from './ui'

const INK = '#1a2b6d'

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
  /** A signature already drawn in this request that can be reused. */
  previous: string | null
  /** How many other fields of this type are still unsigned. */
  emptyCount: number
  onApply: (png: string, applyToAll: boolean) => void
  onClose: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [empty, setEmpty] = useState(true)

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
    const element = canvas.current
    element?.getContext('2d')?.clearRect(0, 0, element.width, element.height)
    setEmpty(true)
  }

  const apply = (applyToAll: boolean) => {
    const png = canvas.current ? trimmedPng(canvas.current) : null
    if (png) {
      onApply(png, applyToAll)
    }
  }

  return <Modal open title={title} className="signature-pad-modal" onClose={onClose}>
    <p className="signature-pad-help">Draw with your mouse, pen, or finger.</p>
    <div className="signature-pad-surface">
    <canvas ref={canvas} className="signature-pad-canvas" aria-label="Signature drawing area"
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
      <button type="button" onClick={clear} disabled={empty}><Eraser size={14} />Clear</button>
      {previous && <button type="button" onClick={() => onApply(previous, false)}><History size={14} />Use previous</button>}
      <span className="signature-pad-spacer" />
      <button type="button" className="ghost" onClick={onClose}>Cancel</button>
      {emptyCount > 0 && <button type="button" disabled={empty} onClick={() => apply(true)}
        title={`Also apply to ${emptyCount} other unsigned field${emptyCount === 1 ? '' : 's'}`}>
        <CopyCheck size={14} />Apply to all ({emptyCount + 1})
      </button>}
      <button type="button" className="primary" disabled={empty} onClick={() => apply(false)}><Check size={14} />Apply</button>
    </div>
  </Modal>
}
