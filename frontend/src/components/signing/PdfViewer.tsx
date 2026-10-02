import { lazy, Suspense, useEffect, useEffectEvent, useState, type ReactNode } from 'react'
import { Download, FileText, Globe, PenLine, X } from 'lucide-react'
import { ErrorBanner, MaximizeButton, Modal } from './ui'

import { useViewerMaximized } from './useViewerMaximized'

const PdfJsViewer = lazy(() => import('./PdfJsViewer'))

export function PdfViewer({ name, sourceKey, load, onClose, onSignatures, footer }: {
  name: string
  sourceKey: string
  load: (signal: AbortSignal) => Promise<Blob>
  onClose: () => void
  onSignatures?: () => void
  footer?: ReactNode
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewer, setViewer] = useState<'browser' | 'in-app'>('in-app')
  const [maximized, toggleMaximized] = useViewerMaximized()

  const loadDocument = useEffectEvent((signal: AbortSignal) => load(signal))

  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | undefined
    setUrl(null)
    setError(null)
    loadDocument(controller.signal).then(blob => {
      if (!controller.signal.aborted) {
        objectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
        setUrl(objectUrl)
      }
    }).catch(cause => {
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
    // sourceKey identifies the PDF; capture the loader for this request.
  }, [sourceKey])

  return <Modal open title={`Preview ${name}`} className={maximized ? 'pdf-preview-modal is-maximized' : 'pdf-preview-modal'} onClose={onClose}
    footer={footer}
    headerActions={<div className="pdf-preview-actions">
      <div className="pdf-viewer-switch" role="group" aria-label="PDF viewer">
        <button aria-pressed={viewer === 'in-app'} onClick={() => setViewer('in-app')}><FileText size={14} aria-hidden="true" />In-app</button>
        <button title="Uses your browser's PDF settings, which may download the file instead of displaying it."
          aria-pressed={viewer === 'browser'} onClick={() => setViewer('browser')}><Globe size={14} aria-hidden="true" />Browser</button>
      </div>
      {url && <a className="button-link" href={url} download={name}><Download size={14} />Download</a>}
      {onSignatures && <button onClick={onSignatures}><PenLine size={14} />Signatures</button>}
      <MaximizeButton maximized={maximized} onToggle={toggleMaximized} />
      <button className="ghost" onClick={onClose}><X size={15} />Close</button>
    </div>}>
    {error ? <ErrorBanner message={error} /> : !url ? <p role="status">Downloading PDF…</p> : viewer === 'in-app' ? (
      <Suspense fallback={<p role="status">Loading in-app viewer…</p>}>
        <PdfJsViewer key={url} url={url} />
      </Suspense>
    ) : (
      <object data={url} type="application/pdf" aria-label={`PDF preview: ${name}`}>
        <p>Your browser cannot display this PDF. <a href={url} download={name}>Download the PDF</a> to open it.</p>
      </object>
    )}
  </Modal>
}
