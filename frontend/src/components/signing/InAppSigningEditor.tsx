import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { CalendarDays, CheckCheck, Eye, Hand, PenLine, Save, Signature, TextCursorInput, Trash2, Type, X } from 'lucide-react'
import { Document, Page } from 'react-pdf'
import {
  completeInAppSigning, downloadAttachmentFile, getSigningFields, saveSigningFields,
  type SigningField, type SigningFieldType,
} from './client'
import { flattenSignedPdf, isImageField } from './flattenSignedPdf'
import { pdfDocumentOptions } from './pdfjs'
import { ErrorBanner, LoadingBar, Modal } from './ui'
import { PdfViewer } from './PdfViewer'
import { SignaturePad } from './SignaturePad'

const FIELD_MIME = 'application/x-signing-field'

/** Default field sizes in PDF points, converted to page fractions when a field is placed. */
const FIELD_TYPES: { type: SigningFieldType; label: string; icon: ReactNode; width: number; height: number }[] = [
  { type: 'signature', label: 'Signature', icon: <Signature size={16} aria-hidden="true" />, width: 180, height: 54 },
  { type: 'initials', label: 'Initials', icon: <Type size={16} aria-hidden="true" />, width: 72, height: 40 },
  { type: 'date', label: 'Date', icon: <CalendarDays size={16} aria-hidden="true" />, width: 110, height: 24 },
  { type: 'text', label: 'Text', icon: <TextCursorInput size={16} aria-hidden="true" />, width: 180, height: 24 },
]

const MIN_SIZE = 0.01

const label = (type: SigningFieldType) => FIELD_TYPES.find(x => x.type === type)?.label ?? type

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const today = () => new Date().toLocaleDateString()

type PageSize = { width: number; height: number }

type Drag = { id: string; kind: 'move' | 'resize'; startX: number; startY: number; origin: SigningField; rect: DOMRect }

/** Renders the page bitmap only near the viewport so long documents stay responsive. */
function PageSlot({ number, width, size, root, children }: {
  number: number
  width: number
  size: PageSize
  root: HTMLElement | null
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(number <= 2)

  useEffect(() => {
    const element = ref.current
    if (!element || !root) {
      return
    }
    const nearby = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { root, rootMargin: '800px 0px' })
    nearby.observe(element)
    return () => {
      nearby.disconnect()
    }
  }, [root, number])

  return <div ref={ref} className="signing-page" style={{ width, height: width * size.height / size.width }}
    aria-label={`Page ${number}`} role="group">
    {near && <Page pageNumber={number} width={width} renderTextLayer={false} renderAnnotationLayer={false}
      loading={<p role="status">Rendering page {number}…</p>} />}
    {children}
  </div>
}

export default function InAppSigningEditor({ attachmentId, requestId, name, onClose, onCompleted }: {
  attachmentId: string
  requestId: string
  name: string
  onClose: () => void
  onCompleted: () => void
}) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [original, setOriginal] = useState<ArrayBuffer | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [pageSizes, setPageSizes] = useState<PageSize[]>([])
  const [fields, setFields] = useState<SigningField[]>([])
  const [savedJson, setSavedJson] = useState('[]')
  const [mode, setMode] = useState<'place' | 'sign'>('place')
  const [selected, setSelected] = useState<string | null>(null)
  const [padFieldId, setPadFieldId] = useState<string | null>(null)
  const [missing, setMissing] = useState<Set<string>>(new Set())
  const [activePage, setActivePage] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [preview, setPreview] = useState<{ key: number; pdf: Blob } | null>(null)
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const [scrollerWidth, setScrollerWidth] = useState<number | null>(null)
  const drag = useRef<Drag | null>(null)
  const pending = useRef(false)
  const dirty = JSON.stringify(fields) !== savedJson
  const editable = status === 'Draft'
  // Keep the palette's space while the status loads so the page area does not narrow afterwards.
  const showPalette = status === null || editable
  const pageWidth = scrollerWidth === null ? null : Math.max(240, Math.min(1200, scrollerWidth - 48))
  const padField = fields.find(x => x.id === padFieldId) ?? null

  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | undefined
    Promise.all([downloadAttachmentFile(attachmentId, requestId, controller.signal), getSigningFields(attachmentId, requestId, controller.signal)])
      .then(async ([blob, saved]) => {
        const bytes = await blob.arrayBuffer()
        if (controller.signal.aborted) {
          return
        }
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
        setOriginal(bytes)
        setPdfUrl(objectUrl)
        setStatus(saved.status)
        setFields(saved.fields)
        setSavedJson(JSON.stringify(saved.fields))
        setMode(saved.fields.length ? 'sign' : 'place')
      })
      .catch(cause => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })
    return () => {
      controller.abort()
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [attachmentId, requestId])

  useEffect(() => {
    if (!scroller) {
      return
    }
    // Every width change redraws each page canvas, so ignore sub-pixel jitter.
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width)
      if (width > 0) {
        setScrollerWidth(current => current !== null && Math.abs(current - width) < 2 ? current : width)
      }
    })
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [scroller])

  useEffect(() => {
    if (!scroller) {
      return
    }
    // Select one page nearest the viewport center, rather than letting independent
    // observers overwrite each other when multiple pages intersect the viewport.
    const updateActivePage = () => {
      const viewport = scroller.getBoundingClientRect()
      const center = viewport.top + scroller.clientHeight / 2
      let closest = Infinity
      let page = 1
      scroller.querySelectorAll<HTMLElement>('.signing-page').forEach((element, index) => {
        const rect = element.getBoundingClientRect()
        const distance = Math.max(rect.top - center, center - rect.bottom, 0)
        if (distance < closest) {
          closest = distance
          page = index + 1
        }
      })
      setActivePage(page)
    }
    updateActivePage()
    scroller.addEventListener('scroll', updateActivePage, { passive: true })
    const observer = new ResizeObserver(updateActivePage)
    observer.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', updateActivePage)
      observer.disconnect()
    }
  }, [scroller, pageSizes, pageWidth])

  const run = async (action: () => Promise<void>) => {
    if (pending.current) {
      return
    }
    pending.current = true
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  const update = (id: string, change: Partial<SigningField>) => {
    setFields(values => values.map(value => value.id === id ? { ...value, ...change } : value))
    setMissing(values => {
      if (!values.has(id)) {
        return values
      }
      const next = new Set(values)
      next.delete(id)
      return next
    })
  }

  const addField = (type: SigningFieldType, page: number, centerX?: number, centerY?: number) => {
    const size = pageSizes[page - 1]
    const spec = FIELD_TYPES.find(x => x.type === type)
    if (!size || !spec || !editable) {
      return
    }
    const width = Math.min(0.9, spec.width / size.width)
    const height = Math.min(0.5, spec.height / size.height)
    const stagger = fields.filter(x => x.page === page).length % 8
    const x = clamp((centerX ?? 0.5) - width / 2, 0, 1 - width)
    const y = clamp(centerY === undefined ? 0.15 + stagger * 0.06 : centerY - height / 2, 0, 1 - height)
    const field: SigningField = { id: crypto.randomUUID(), type, page, x, y, width, height, value: null }
    setFields(values => [...values, field])
    setSelected(field.id)
  }

  const removeField = (id: string) => {
    setFields(values => values.filter(x => x.id !== id))
    setSelected(null)
  }

  const save = async () => {
    const result = await saveSigningFields(attachmentId, requestId, fields)
    setSavedJson(JSON.stringify(result.fields))
  }

  const startSigning = () => {
    if (!fields.length) {
      setError('Add at least one field before signing.')
      return
    }
    setError(null)
    setSelected(null)
    // Date fields default to the signing date; the signer can still change it.
    setFields(values => values.map(x => x.type === 'date' && !x.value ? { ...x, value: today() } : x))
    setMode('sign')
  }

  // Builds the document exactly as Finish would, from the current (possibly unsaved) fields,
  // without saving or uploading anything. Empty fields are left out so a partial layout can be checked.
  const showPreview = () => void run(async () => {
    if (!original) {
      throw new Error('The document has not finished loading.')
    }
    const values = fields.map(x => x.type === 'date' && !x.value ? { ...x, value: today() } : x)
    const pdf = await flattenSignedPdf(original.slice(0), values, { skipEmpty: true })
    setPreview(current => ({ key: (current?.key ?? 0) + 1, pdf: new Blob([pdf as BlobPart], { type: 'application/pdf' }) }))
    const empty = values.filter(x => !x.value?.trim()).length
    if (empty) {
      setNotice(`The preview leaves out ${empty} empty field${empty === 1 ? '' : 's'}. Complete ${empty === 1 ? 'it' : 'them'} before finishing.`)
    }
  })

  const finish = () => void run(async () => {
    const completed = fields.map(x => x.type === 'date' && !x.value ? { ...x, value: today() } : x)
    setFields(completed)
    const empty = completed.filter(x => !x.value?.trim())
    if (!completed.some(isImageField)) {
      setMode('place')
      throw new Error('Add at least one signature or initials field before finishing.')
    }
    if (empty.length) {
      setMode('sign')
      setMissing(new Set(empty.map(x => x.id)))
      document.querySelector(`[data-field-id="${empty[0].id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      throw new Error(`Complete ${empty.length} highlighted field${empty.length === 1 ? '' : 's'} before finishing.`)
    }
    if (!original) {
      throw new Error('The document has not finished loading.')
    }
    const saved = await saveSigningFields(attachmentId, requestId, completed)
    setSavedJson(JSON.stringify(saved.fields))
    const pdf = await flattenSignedPdf(original.slice(0), saved.fields)
    await completeInAppSigning(attachmentId, requestId, new Blob([pdf as BlobPart], { type: 'application/pdf' }))
    setStatus('completed')
    onCompleted()
  })

  const requestClose = () => {
    if (busy) {
      return
    }
    if (dirty && editable) {
      setConfirmClose(true)
      return
    }
    onClose()
  }

  const beginDrag = (event: React.PointerEvent<HTMLElement>, field: SigningField, kind: Drag['kind']) => {
    if (mode !== 'place' || event.button !== 0) {
      return
    }
    const overlay = event.currentTarget.closest('.signing-page-overlay')
    if (!overlay) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    ;(event.currentTarget.closest('.signing-field') as HTMLElement | null)?.focus()
    drag.current = { id: field.id, kind, startX: event.clientX, startY: event.clientY, origin: field, rect: overlay.getBoundingClientRect() }
    setSelected(field.id)
  }

  const moveDrag = (event: React.PointerEvent<HTMLElement>) => {
    const current = drag.current
    if (!current) {
      return
    }
    const dx = (event.clientX - current.startX) / current.rect.width
    const dy = (event.clientY - current.startY) / current.rect.height
    const { origin } = current
    if (current.kind === 'move') {
      update(origin.id, { x: clamp(origin.x + dx, 0, 1 - origin.width), y: clamp(origin.y + dy, 0, 1 - origin.height) })
    } else {
      update(origin.id, { width: clamp(origin.width + dx, MIN_SIZE, 1 - origin.x), height: clamp(origin.height + dy, MIN_SIZE, 1 - origin.y) })
    }
  }

  const endDrag = () => {
    drag.current = null
  }

  const fieldKeys = (event: React.KeyboardEvent<HTMLElement>, field: SigningField) => {
    if (mode !== 'place' || event.target !== event.currentTarget) {
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      removeField(field.id)
      return
    }
    const step = event.shiftKey ? 0.05 : 0.005
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const move = moves[event.key]
    if (move) {
      event.preventDefault()
      update(field.id, { x: clamp(field.x + move[0], 0, 1 - field.width), y: clamp(field.y + move[1], 0, 1 - field.height) })
    }
  }

  const renderField = (field: SigningField) => {
    const style = { left: `${field.x * 100}%`, top: `${field.y * 100}%`, width: `${field.width * 100}%`, height: `${field.height * 100}%` }
    const className = ['signing-field', `signing-field-${field.type}`, field.value ? 'is-filled' : '',
      selected === field.id ? 'is-selected' : '', missing.has(field.id) ? 'is-missing' : ''].filter(Boolean).join(' ')
    const value = field.value && isImageField(field)
      ? <img src={field.value} alt="" draggable={false} />
      : field.value ? <span className="signing-field-value">{field.value}</span> : null

    if (mode === 'sign') {
      if (isImageField(field)) {
        return <button key={field.id} type="button" data-field-id={field.id} className={className} style={style}
          disabled={!editable} aria-label={`${label(field.type)} field on page ${field.page}${field.value ? ', signed' : ', click to sign'}`}
          onClick={() => setPadFieldId(field.id)}>
          {value ?? <span className="signing-field-prompt"><PenLine size={14} aria-hidden="true" />Click to {field.type === 'initials' ? 'initial' : 'sign'}</span>}
        </button>
      }
      return <input key={field.id} data-field-id={field.id} className={className} style={style} type="text"
        maxLength={500} disabled={!editable} value={field.value ?? ''} placeholder={label(field.type)}
        aria-label={`${label(field.type)} field on page ${field.page}`}
        onChange={event => update(field.id, { value: event.target.value || null })} />
    }

    return <div key={field.id} data-field-id={field.id} className={className} style={style} tabIndex={0} role="button"
      aria-label={`${label(field.type)} field on page ${field.page}. Drag to move, arrow keys to nudge, Delete to remove.`}
      onFocus={() => setSelected(field.id)}
      onKeyDown={event => fieldKeys(event, field)}
      onPointerDown={event => beginDrag(event, field, 'move')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
      {value ?? <span className="signing-field-label">{FIELD_TYPES.find(x => x.type === field.type)?.icon}{label(field.type)}</span>}
      <button type="button" className="signing-field-remove" aria-label={`Remove ${label(field.type)} field`}
        onPointerDown={event => event.stopPropagation()} onClick={() => removeField(field.id)}><X size={12} /></button>
      <span className="signing-field-resize" aria-hidden="true"
        onPointerDown={event => beginDrag(event, field, 'resize')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
    </div>
  }

  const imageFields = fields.filter(isImageField)
  const signedCount = fields.filter(x => x.value?.trim()).length
  const loading = !pdfUrl && !error

  return <>
    <Modal open title={`Sign — ${name}`} className="in-app-signing-modal" onClose={requestClose}
      headerActions={<div className="in-app-signing-actions">
        {editable && <div className="pdf-viewer-switch" role="group" aria-label="Editor mode">
          <button aria-pressed={mode === 'place'} disabled={busy} onClick={() => {
            setMode('place')
            setMissing(new Set())
          }}><Hand size={14} aria-hidden="true" />Place fields</button>
          <button aria-pressed={mode === 'sign'} disabled={busy} onClick={startSigning}><PenLine size={14} aria-hidden="true" />Sign</button>
        </div>}
        {editable && <button disabled={busy || !dirty} onClick={() => void run(async () => {
          await save()
          setNotice(mode === 'place' ? 'Fields saved. Choose Sign to fill them in.' : 'Progress saved.')
        })}><Save size={14} />{mode === 'place' ? 'Save fields' : 'Save'}</button>}
        {editable && <button disabled={busy || !original} onClick={showPreview}
          title="See the signed PDF before finishing. Nothing is saved."><Eye size={14} />Preview</button>}
        {editable && <button className="primary" disabled={busy || !original} onClick={finish}><CheckCheck size={14} />Finish</button>}
        <button className="ghost" disabled={busy} onClick={requestClose}><X size={15} />Close</button>
      </div>}>
      <LoadingBar active={busy || loading} />
      {error && <ErrorBanner message={error} />}
      {notice && <p className="signing-notice" role="status">{notice}</p>}
      {status && !editable && <p className="signing-notice" role="status">This request has been finished. Preview or download the signed PDF from the signing requests list.</p>}
      <div className="in-app-signing-layout">
        {showPalette && <aside className="signing-palette" aria-label="Fields">
          {mode === 'place' ? <>
            <p>Drag a field onto the document, or click to add it to page {activePage}.</p>
            {FIELD_TYPES.map(spec => <button key={spec.type} type="button" draggable className="signing-palette-item"
              disabled={!pageSizes.length}
              onDragStart={event => {
                event.dataTransfer.setData(FIELD_MIME, spec.type)
                event.dataTransfer.effectAllowed = 'copy'
              }}
              onClick={() => addField(spec.type, activePage)}>
              {spec.icon}{spec.label}
            </button>)}
            <p className="signing-palette-count">{fields.length} field{fields.length === 1 ? '' : 's'}{dirty ? ' · unsaved' : ''}</p>
          </> : <>
            <p>Click each signature or initials field to draw it, and fill in the date and text fields.</p>
            <p className="signing-palette-count">{signedCount} of {fields.length} complete{dirty ? ' · unsaved' : ''}</p>
            {imageFields.length === 0 && <p>Add a signature field in Place fields first.</p>}
          </>}
        </aside>}
        <div ref={setScroller} className="signing-pages" onPointerDown={event => {
          if (event.target === event.currentTarget) {
            setSelected(null)
          }
        }}>
          {loading && <p role="status">Downloading PDF…</p>}
          {/* react-pdf suspends by default, which would hide this whole dialog behind the lazy-load
              boundary every time the document or a page loads. Use its loading placeholders instead. */}
          <Suspense fallback={<p role="status">Loading PDF…</p>}>
          {pdfUrl && <Document file={pdfUrl} options={pdfDocumentOptions} suspense={false}
            loading={<p role="status">Loading PDF…</p>}
            error={<ErrorBanner message="Could not render this PDF." />}
            onLoadSuccess={pdf => {
              void Promise.all(Array.from({ length: pdf.numPages }, (_, index) => pdf.getPage(index + 1).then(page => {
                const viewport = page.getViewport({ scale: 1 })
                return { width: viewport.width, height: viewport.height }
              }))).then(setPageSizes).catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
            }}>
            {pageWidth !== null && pageSizes.map((size, index) => <PageSlot key={index} number={index + 1} width={pageWidth} size={size} root={scroller}>
              <div className={mode === 'place' && editable ? 'signing-page-overlay is-placing' : 'signing-page-overlay'}
                onDragOver={event => {
                  if (editable && mode === 'place' && event.dataTransfer.types.includes(FIELD_MIME)) {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'copy'
                  }
                }}
                onDrop={event => {
                  const type = event.dataTransfer.getData(FIELD_MIME) as SigningFieldType
                  if (!type) {
                    return
                  }
                  event.preventDefault()
                  const rect = event.currentTarget.getBoundingClientRect()
                  addField(type, index + 1, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height)
                }}>
                {fields.filter(x => x.page === index + 1).map(renderField)}
              </div>
            </PageSlot>)}
          </Document>}
          </Suspense>
        </div>
      </div>
    </Modal>
    {padField && <SignaturePad
      title={padField.type === 'initials' ? 'Draw your initials' : 'Draw your signature'}
      previous={fields.find(x => x.id !== padField.id && x.type === padField.type && x.value)?.value ?? null}
      emptyCount={fields.filter(x => x.id !== padField.id && x.type === padField.type && !x.value).length}
      onClose={() => setPadFieldId(null)}
      onApply={(png, applyToAll) => {
        fields.filter(x => x.id === padField.id || (applyToAll && x.type === padField.type && !x.value))
          .forEach(x => update(x.id, { value: png }))
        setPadFieldId(null)
      }} />}
    {preview && <PdfViewer key={preview.key} name={`preview-${name}`} sourceKey={String(preview.key)}
      load={async () => preview.pdf} onClose={() => setPreview(null)} />}
    {confirmClose && <Modal open title="Unsaved changes" onClose={() => setConfirmClose(false)}>
      <p>You have changes that are not saved. Save them before closing?</p>
      <div className="row signature-list-toolbar">
        <button disabled={busy} onClick={() => setConfirmClose(false)}>Keep editing</button>
        <button className="danger" disabled={busy} onClick={onClose}><Trash2 size={14} />Discard changes</button>
        <button className="primary" disabled={busy} onClick={() => void run(async () => {
          await save()
          onClose()
        })}><Save size={14} />Save and close</button>
      </div>
      {error && <ErrorBanner message={error} />}
    </Modal>}
  </>
}
