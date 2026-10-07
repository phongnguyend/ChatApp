import { useEffect, useRef, type ReactNode } from 'react'
import { Maximize2, Minimize2, X } from 'lucide-react'

/**
 * A modal built on the native <dialog>, so Escape, the focus trap, and the inert backdrop come from
 * the platform rather than being reimplemented. Outside clicks leave the modal open.
 */
export function Modal({
  open,
  title,
  icon,
  className,
  onClose,
  children,
  footer,
  headerActions,
}: {
  open: boolean
  title: string
  icon?: ReactNode
  className?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  headerActions?: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) {
      return
    }

    if (open && !dialog.open) {
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={className ? `modal signing-modal ${className}` : 'modal signing-modal'}
      onDragEnter={(event) => event.stopPropagation()}
      onDragOver={(event) => {
        event.stopPropagation()
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
        }
      }}
      onDragLeave={(event) => event.stopPropagation()}
      onDrop={(event) => {
        // Keep modal drags out of the document library's upload handlers.
        event.stopPropagation()
        event.preventDefault()
      }}
      onCancel={(event) => {
        // File-picker cancellation bubbles from the input; only the dialog's own
        // cancel event (Escape) should close this modal.
        if (event.target !== event.currentTarget) {
          return
        }
        event.preventDefault()
        onClose()
      }}
    >
      <div className="modal-head">
        <h2>
          {icon}
          {title}
        </h2>
        {headerActions ?? <button className="ghost icon-only" onClick={onClose} aria-label="Close">
          <X size={15} />
        </button>}
      </div>
      <div className="modal-body">{children}</div>
      {footer ? <div className="modal-foot">{footer}</div> : null}
    </dialog>
  )
}

export function MaximizeButton({ maximized, onToggle }: { maximized: boolean; onToggle: () => void }) {
  const label = maximized ? 'Restore size' : 'Full screen'
  return <button type="button" className="ghost icon-only" aria-pressed={maximized} aria-label={label} title={label} onClick={onToggle}>
    {maximized ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}
  </button>
}


export function ErrorBanner({ message }: { message: string }) {
  return <p className="form-error" role="alert">{message}</p>
}
export function LoadingBar({ active }: { active: boolean }) {
  return active ? <p role="status">Loading?</p> : null
}
