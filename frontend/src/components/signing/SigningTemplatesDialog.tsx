import { useRef, useState } from 'react'
import { Check, Download, FilePlus2, Pencil, RefreshCw, Save, Trash2 } from 'lucide-react'
import {
  createSigningTemplate, deleteSigningTemplate, getSigningTemplate, listSigningTemplates, renameSigningTemplate, updateSigningTemplate,
  type SigningField, type SigningTemplate, type SigningTemplateSummary,
} from './client'
import { useAsync } from './useAsync'
import { ErrorBanner, LoadingBar, Modal } from './ui'

export type TemplateLoadMode = 'replace' | 'add'

type Confirm = { kind: 'load' | 'update' | 'delete' | 'rename'; template: SigningTemplateSummary }

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/** Loads saved field layouts into the editor, and saves the editor's layout as a new or existing template. */
export function SigningTemplatesDialog({ fields, pageCount, onLoad, onClose }: {
  /** The editor's current fields, including unsaved changes. */
  fields: SigningField[]
  pageCount: number
  onLoad: (template: SigningTemplate, mode: TemplateLoadMode) => void
  onClose: () => void
}) {
  const [revision, setRevision] = useState(0)
  const templates = useAsync(signal => listSigningTemplates(signal), [revision])
  const [name, setName] = useState('')
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const pending = useRef(false)
  const hasFields = fields.length > 0

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

  const load = (template: SigningTemplateSummary, mode: TemplateLoadMode) => void run(async () => {
    onLoad(await getSigningTemplate(template.id), mode)
  })

  return <Modal open title="Field templates" className="signing-templates-modal" onClose={() => {
    if (!busy) {
      onClose()
    }
  }}>
    <LoadingBar active={busy || templates.loading} />
    {(error || templates.error) && <ErrorBanner message={error || templates.error || ''} />}
    {notice && <p className="signing-notice" role="status">{notice}</p>}

    <form className="signing-template-save" onSubmit={event => {
      event.preventDefault()
      void run(async () => {
        const saved = await createSigningTemplate({ name, fields, pageCount })
        setName('')
        setRevision(value => value + 1)
        setNotice(`Saved ${plural(saved.fields.length, 'field')} as "${saved.name}".`)
      })
    }}>
      <h3>Save current fields as a new template</h3>
      <p>Templates keep field positions only. Drawn signatures and typed values are never saved in a template.</p>
      <div className="row">
        <input type="text" required maxLength={100} value={name} placeholder="Template name" aria-label="New template name"
          disabled={busy || !hasFields} onChange={event => setName(event.target.value)} />
        <button type="submit" className="primary" disabled={busy || !hasFields || !name.trim()}>
          <FilePlus2 size={14} />Save as new
        </button>
      </div>
      {!hasFields && <p className="signing-template-hint">Place at least one field to save a template.</p>}
    </form>

    <section className="signing-template-list" aria-label="Your templates">
      <div className="row signing-template-list-head">
        <h3>Your templates</h3>
        <button type="button" className="ghost" disabled={busy} onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} />Reload</button>
      </div>
      {templates.data?.length === 0 && <p>No templates yet. Place fields on a document and save them here to reuse the layout.</p>}
      {templates.data?.map(template => {
        const confirming = confirm?.template.id === template.id ? confirm.kind : null
        return <div className="signing-template-row" key={template.id}>
          <div className="signing-template-info">
            {confirming === 'rename' ? <form className="row signing-template-rename" onSubmit={event => {
              event.preventDefault()
              void run(async () => {
                const saved = await renameSigningTemplate(template.id, newName)
                setConfirm(null)
                setRevision(value => value + 1)
                setNotice(`Renamed "${template.name}" to "${saved.name}".`)
              })
            }}>
              <input type="text" required maxLength={100} value={newName} aria-label={`New name for ${template.name}`} autoFocus
                disabled={busy} onChange={event => setNewName(event.target.value)}
                onKeyDown={event => {
                  // Escape cancels the rename rather than closing the whole dialog.
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    event.stopPropagation()
                    setConfirm(null)
                  }
                }} />
              <button type="submit" className="primary" disabled={busy || !newName.trim() || newName.trim() === template.name}>
                <Check size={14} />Save name
              </button>
              <button type="button" className="ghost" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
            </form> : <strong>{template.name}</strong>}
            <span>
              {plural(template.fieldCount, 'field')} · {plural(template.pageCount, 'page')}
              {template.pageCount > pageCount && ` · ${template.pageCount - pageCount} more than this document`}
              {' · updated '}<time dateTime={template.updatedAtUtc}>{new Date(template.updatedAtUtc).toLocaleDateString()}</time>
            </span>
          </div>
          {confirming === 'load' ? <div className="row signing-template-confirm" role="group" aria-label={`Load ${template.name}`}>
            <span>You already have {plural(fields.length, 'field')}.</span>
            <button type="button" className="danger" disabled={busy} onClick={() => load(template, 'replace')}>Replace them</button>
            <button type="button" className="primary" disabled={busy} onClick={() => load(template, 'add')}>Add to them</button>
            <button type="button" className="ghost" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
          </div> : confirming === 'update' ? <div className="row signing-template-confirm" role="group" aria-label={`Update ${template.name}`}>
            <span>Replace its {plural(template.fieldCount, 'field')} with your {plural(fields.length, 'current field')}?</span>
            <button type="button" className="primary" disabled={busy} onClick={() => void run(async () => {
              const saved = await updateSigningTemplate(template.id, { name: template.name, fields, pageCount })
              setConfirm(null)
              setRevision(value => value + 1)
              setNotice(`Updated "${saved.name}" with ${plural(saved.fields.length, 'field')}.`)
            })}><Save size={14} />Update template</button>
            <button type="button" className="ghost" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
          </div> : confirming === 'delete' ? <div className="row signing-template-confirm" role="group" aria-label={`Delete ${template.name}`}>
            <span>Delete this template? Requests that used it are not affected.</span>
            <button type="button" className="danger" disabled={busy} onClick={() => void run(async () => {
              await deleteSigningTemplate(template.id)
              setConfirm(null)
              setRevision(value => value + 1)
              setNotice(`Deleted "${template.name}".`)
            })}><Trash2 size={14} />Delete</button>
            <button type="button" className="ghost" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
          </div> : confirming === 'rename' ? null : <div className="row signing-template-actions">
            <button type="button" disabled={busy} onClick={() => hasFields ? setConfirm({ kind: 'load', template }) : load(template, 'replace')}>
              <Download size={14} />Load
            </button>
            <button type="button" disabled={busy || !hasFields} title={hasFields ? 'Overwrite this template with the current fields' : 'Place fields first'}
              onClick={() => setConfirm({ kind: 'update', template })}><Save size={14} />Update</button>
            <button type="button" disabled={busy} aria-label={`Rename ${template.name}`} onClick={() => {
              setNewName(template.name)
              setConfirm({ kind: 'rename', template })
            }}><Pencil size={14} aria-hidden="true" />Rename</button>
            <button type="button" className="danger" disabled={busy} aria-label={`Delete ${template.name}`}
              onClick={() => setConfirm({ kind: 'delete', template })}><Trash2 size={14} aria-hidden="true" />Delete</button>
          </div>}
        </div>
      })}
    </section>
  </Modal>
}
