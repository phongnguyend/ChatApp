import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Document, Page } from 'react-pdf'
import { ErrorBanner } from './ui'
import { pdfDocumentOptions as documentOptions } from './pdfjs'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

export default function PdfJsViewer({ url }: { url: string }) {
  const [pages, setPages] = useState(0)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(600)
  const container = useRef<HTMLDivElement>(null)
  const thumbnails = useRef<HTMLDivElement>(null)
  const [thumbnailTop, setThumbnailTop] = useState(0)
  const [thumbnailHeight, setThumbnailHeight] = useState(600)
  const [showThumbnails, setShowThumbnails] = useState(true)
  const thumbnailRowHeight = 174
  const firstThumbnail = Math.max(0, Math.floor(thumbnailTop / thumbnailRowHeight) - 2)
  const lastThumbnail = Math.min(pages, Math.ceil((thumbnailTop + thumbnailHeight) / thumbnailRowHeight) + 2)

  useEffect(() => {
    const element = container.current
    if (!element) {
      return
    }
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(100, entry.contentRect.width - 32))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [pages])

  useEffect(() => {
    const element = thumbnails.current
    if (!element) {
      return
    }
    const observer = new ResizeObserver(([entry]) => setThumbnailHeight(entry.contentRect.height))
    observer.observe(element)
    const top = (page - 1) * thumbnailRowHeight
    if (top < element.scrollTop || top + thumbnailRowHeight > element.scrollTop + element.clientHeight) {
      element.scrollTop = top
    }
    setThumbnailTop(element.scrollTop)
    return () => observer.disconnect()
  }, [page, pages, showThumbnails])

  return <div className="pdf-js-viewer">
      <Document className="pdf-js-document" file={url} options={documentOptions} suspense={false} onLoadSuccess={({ numPages }) => setPages(numPages)}
        loading={<p role="status">Loading PDF…</p>}
        error={<ErrorBanner message="Could not render this PDF. Try the Browser option or download the file." />}>
        {showThumbnails && <div ref={thumbnails} className="pdf-thumbnail-list" aria-label="PDF page thumbnails"
          onScroll={event => setThumbnailTop(event.currentTarget.scrollTop)}>
          <div style={{ height: pages * thumbnailRowHeight, position: 'relative' }}>
            {Array.from({ length: Math.max(0, lastThumbnail - firstThumbnail) }, (_, index) => {
              const number = firstThumbnail + index + 1
              return <button key={number} className="pdf-thumbnail" aria-label={`Go to page ${number}`}
                aria-current={page === number ? 'page' : undefined}
                style={{ position: 'absolute', top: (number - 1) * thumbnailRowHeight }}
                onClick={() => setPage(number)}>
                <div className="pdf-thumbnail-preview" aria-hidden="true">
                  <Page pageNumber={number} width={110} devicePixelRatio={1}
                    renderTextLayer={false} renderAnnotationLayer={false}
                    loading={<span>Loading…</span>} error={<span>No preview</span>} />
                </div>
                <span>{number}</span>
              </button>
            })}
          </div>
        </div>}
        <div ref={container} className="pdf-js-pages">
        <Page key={page} pageNumber={page} width={width * zoom}
          loading={<p role="status">Rendering page…</p>}
          error={<ErrorBanner message="Could not render this page. Try the Browser option or download the file." />} />
        </div>
      </Document>
    <div className="pdf-viewer-controls" role="group" aria-label="PDF page controls">
      <button className="pdf-thumbnail-toggle" aria-pressed={showThumbnails}
        title={showThumbnails ? 'Hide thumbnails' : 'Show thumbnails'}
        onClick={() => setShowThumbnails(value => !value)}>
        {showThumbnails ? <PanelLeftClose size={16} aria-hidden="true" /> : <PanelLeftOpen size={16} aria-hidden="true" />}
        {showThumbnails ? 'Hide thumbnails' : 'Show thumbnails'}
      </button>
      <div className="pdf-page-navigation">
        <button disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={16} aria-hidden="true" />Previous</button>
        <span aria-live="polite">Page {pages ? page : 0} of {pages}</span>
        <button disabled={page >= pages} onClick={() => setPage(value => value + 1)}>Next<ChevronRight size={16} aria-hidden="true" /></button>
      </div>
      <label className="pdf-zoom-control">Zoom <select value={zoom} onChange={event => setZoom(Number(event.target.value))}>
        <option value={0.5}>50%</option>
        <option value={0.75}>75%</option>
        <option value={1}>Fit width</option>
        <option value={1.25}>125%</option>
        <option value={1.5}>150%</option>
        <option value={2}>200%</option>
      </select></label>
    </div>
  </div>
}
