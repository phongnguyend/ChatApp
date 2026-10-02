import { lazy, Suspense, useId, useRef, useState } from 'react'
import { Download, ExternalLink, Eye, FilePenLine, FilePlus2, List, MonitorSmartphone, PenLine, Plus, RefreshCw, Signature, Trash2 } from 'lucide-react'
import { type SignatureRequest, createSignatureRequest, deleteSignatureRequest, downloadSignatureDocument, getSigningProviders, listSignatureRequests, prepareSignatureRequest, refreshSignatureRequest } from './client'
import { useAsync } from './useAsync'
import { ErrorBanner, LoadingBar, Modal } from './ui'
import { PdfViewer } from './PdfViewer'

const InAppSigningEditor = lazy(() => import('./InAppSigningEditor'))

const IN_APP = 'InApp'

function SigningProvider({ provider }: { provider: string }) {
  const adobe = provider === 'AdobeSign'
  const inApp = provider === IN_APP
  const Icon = inApp ? MonitorSmartphone : adobe ? FilePenLine : Signature

  return <span className="signature-provider-label">
    <Icon size={18} aria-hidden="true" className={`signature-provider-icon ${inApp ? 'in-app' : adobe ? 'adobe-sign' : 'docusign'}`} />
    {inApp ? 'In-App Signature' : adobe ? 'Adobe Acrobat Sign' : provider}
  </span>
}

function SignatureRequestDetails({ row }: { row: SignatureRequest }) {
  let signers: { name: string; email: string }[] = []
  try {
    // Stored server-side with .NET's default PascalCase property names.
    signers = (JSON.parse(row.recipientsJson) as { Name: string; Email: string }[]).map(x => ({ name: x.Name, email: x.Email }))
  } catch {
    signers = []
  }
  if (!signers.length && !row.message) {
    return null
  }
  return <dl className="signature-request-details">
    {signers.length > 0 && <><dt>Signers{row.provider === IN_APP ? ' (tracked, not notified)' : ''}</dt>
      <dd><ol>{signers.map(x => <li key={x.email}>{x.name} &lt;{x.email}&gt;</li>)}</ol></dd></>}
    {row.message && <><dt>Message</dt><dd>{row.message}</dd></>}
  </dl>
}

export function SignatureRequests({ id, name, readOnly, onClose }: {
  id: string; name: string; readOnly: boolean; onClose: () => void
}) {
  const providers = useAsync(getSigningProviders, [])
  const tabId = useId()
  const [tab, setTab] = useState<'new' | 'requests'>(readOnly ? 'requests' : 'new')
  const activeTab = readOnly ? 'requests' : tab
  const [revision, setRevision] = useState(0)
  const requests = useAsync(signal => listSignatureRequests(id, signal), [id, revision])
  const [provider, setProvider] = useState('')
  const [subject, setSubject] = useState(name.slice(0, 100))
  const [message, setMessage] = useState('')
  const [recipients, setRecipients] = useState([{ name: '', email: '' }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preparationUrl, setPreparationUrl] = useState<string | null>(null)
  const [createdDraft, setCreatedDraft] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ requestId: string; audit: boolean } | null>(null)
  const [editorId, setEditorId] = useState<string | null>(null)
  const clientRequestId = useRef(crypto.randomUUID())
  const pending = useRef(false)
  const selectedProvider = provider || providers.data?.[0] || ''
  const inAppSelected = selectedProvider === IN_APP

  const run = async (action: () => Promise<void>) => {
    if (pending.current) {
      return
    }
    pending.current = true
    setBusy(true)
    setError(null)
    setPreparationUrl(null)
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pending.current = false
      setBusy(false)
      setRevision(value => value + 1)
    }
  }

  const prepare = async (requestId: string) => {
    const result = await prepareSignatureRequest(id, requestId)
    setPreparationUrl(result.url)
  }

  const download = async (requestId: string, audit: boolean) => {
    const blob = await downloadSignatureDocument(id, requestId, audit)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${audit ? 'audit' : 'signed'}-${name}`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <><Modal open title={`Signatures — ${name}`} className="signature-requests-modal" onClose={onClose}>
    <LoadingBar active={busy || requests.loading || providers.loading} />
    <div className="attachment-tabs" role="tablist" aria-label="Signatures" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        return
      }
      event.preventDefault()
      const next = readOnly || event.key === 'End' ? 'requests' : event.key === 'Home' ? 'new' : activeTab === 'new' ? 'requests' : 'new'
      setTab(next)
      event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus()
    }}>
      {!readOnly && <button type="button" role="tab" id={`${tabId}-new`} data-tab="new"
        aria-selected={activeTab === 'new'} aria-controls={`${tabId}-new-panel`} tabIndex={activeTab === 'new' ? 0 : -1}
        onClick={() => setTab('new')}><FilePlus2 size={14} aria-hidden="true" />New request</button>}
      <button type="button" role="tab" id={`${tabId}-requests`} data-tab="requests"
        aria-selected={activeTab === 'requests'} aria-controls={`${tabId}-requests-panel`} tabIndex={activeTab === 'requests' ? 0 : -1}
        onClick={() => setTab('requests')}><List size={14} aria-hidden="true" />Signing requests</button>
    </div>
    {(error || requests.error || providers.error) && <ErrorBanner message={error || requests.error || providers.error || ''} />}
    {preparationUrl && <p><a className="button-link" href={preparationUrl} target="_blank" rel="noopener noreferrer">
      <ExternalLink size={14} />Open preparation screen
    </a> Place fields and send there, then return here and refresh the request status.</p>}
    {!readOnly && <div role="tabpanel" id={`${tabId}-new-panel`} aria-labelledby={`${tabId}-new`} hidden={activeTab !== 'new'}>
    <form onSubmit={event => {
      event.preventDefault()
      void run(async () => {
        // In-app signers are optional, so blank rows are left out rather than rejected.
        const signers = inAppSelected ? recipients.filter(x => x.name.trim() || x.email.trim()) : recipients
        const row = await createSignatureRequest(id, { provider: selectedProvider, subject, message, recipients: signers, clientRequestId: clientRequestId.current })
        setCreatedDraft(true)
        setTab('requests')
        if (row.provider === IN_APP) {
          setEditorId(row.id)
          return
        }
        if (!row.externalId) {
          throw new Error('This request needs administrator review in the provider account. Do not create a replacement until it has been checked.')
        }
        await prepare(row.id)
      })
    }}>
      <fieldset disabled={busy || createdDraft || !providers.data?.length} className="signature-form">
        <legend>New signing request</legend>
        {inAppSelected
          ? <p>Sign this PDF yourself without leaving the app. Drag signature, initials, date, and text fields onto the pages, save them, then draw your signature and finish to produce the signed PDF. The message and signers are optional and recorded with the request; no one is notified yet. In-app signatures are drawn images, not certificate-based digital signatures.</p>
          : <p>Send through the shared company account. Recipients sign in the order listed. Creating a draft uploads this PDF to the selected provider; you review and send it in their preparation screen.</p>}
        <div className="signature-provider-field">
          <span>Provider</span>
          <div className="signature-provider-options" role="group" aria-label="Signing provider">
            {providers.data?.map(value => <button key={value} type="button"
              aria-pressed={selectedProvider === value} onClick={() => setProvider(value)}>
              <SigningProvider provider={value} />
            </button>)}
          </div>
        </div>
        <label>Subject<input type="text" value={subject} maxLength={100} required onChange={event => setSubject(event.target.value)} /></label>
        <label>Message<textarea value={message} maxLength={2000} onChange={event => setMessage(event.target.value)} /></label>
        {recipients.map((recipient, index) => {
          // A signer row is optional for in-app requests, but a started row needs both values.
          const required = !inAppSelected || Boolean(recipient.name.trim() || recipient.email.trim())
          return <div className="signature-recipient" key={index}>
            <label>Signer {index + 1} name<input type="text" required={required} maxLength={100} value={recipient.name}
              onChange={event => setRecipients(values => values.map((value, i) => i === index ? { ...value, name: event.target.value } : value))} /></label>
            <label>Email<input type="email" required={required} maxLength={254} value={recipient.email}
              onChange={event => setRecipients(values => values.map((value, i) => i === index ? { ...value, email: event.target.value } : value))} /></label>
            <button type="button" disabled={recipients.length === 1} aria-label={`Remove signer ${index + 1}`}
              onClick={() => setRecipients(values => values.filter((_, i) => i !== index))}><Trash2 size={14} /></button>
          </div>
        })}
        <div className="row">
          <button type="button" disabled={recipients.length >= 20} onClick={() => setRecipients(values => [...values, { name: '', email: '' }])}><Plus size={14} />Add signer</button>
          <button type="submit" className="signature-create-draft">
            {inAppSelected ? <><PenLine size={14} aria-hidden="true" />Open signing editor</> : <><FilePlus2 size={14} aria-hidden="true" />Create draft</>}
          </button>
        </div>
      </fieldset>
      {createdDraft && <button type="button" disabled={busy} onClick={() => {
        clientRequestId.current = crypto.randomUUID()
        setCreatedDraft(false)
        setPreparationUrl(null)
      }}><Plus size={14} />Start another signing request</button>}
      {providers.data?.length === 0 && <p>No signing providers are enabled. Ask an administrator to configure the shared organization connection.</p>}
    </form></div>}
    <div role="tabpanel" id={`${tabId}-requests-panel`} aria-labelledby={`${tabId}-requests`} hidden={activeTab !== 'requests'}>
    <div className="row signature-list-toolbar"><button disabled={busy} onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} />Reload list</button></div>
    {requests.data?.length === 0 && <p>No signing requests yet.</p>}
    {requests.data?.map(row => <section className="signature-request" key={row.id}>
      <strong>{row.subject}</strong>
      <p className="signature-request-meta">
        <SigningProvider provider={row.provider} />
        <span>· {row.status}</span>
        <span>· <time dateTime={row.createdAtUtc}>{new Date(row.createdAtUtc).toLocaleString()}</time></span>
      </p>
      <SignatureRequestDetails row={row} />
      {row.status === 'NeedsReview' || row.status === 'Creating' ? <p>Ask an administrator to check the provider account using reference {row.id}. The result of draft creation has not been confirmed.</p> : null}
      <div className="row">
        {!readOnly && row.status === 'NeedsReview' && <button className="danger" disabled={busy} onClick={() => setDeleteId(row.id)}><Trash2 size={14} />Delete record</button>}
        {!readOnly && row.provider === IN_APP && row.status === 'Draft' && <>
          <button disabled={busy} onClick={() => setEditorId(row.id)}><PenLine size={14} />Continue signing</button>
          <button className="danger" disabled={busy} onClick={() => setDeleteId(row.id)}><Trash2 size={14} />Discard draft</button>
        </>}
        {!readOnly && row.externalId && <button disabled={busy} onClick={() => void run(async () => { await refreshSignatureRequest(id, row.id) })}><RefreshCw size={14} />Refresh status</button>}
        {!readOnly && row.externalId && ['Draft', 'created', 'DRAFT', 'AUTHORING'].includes(row.status) && <button disabled={busy} onClick={() => void run(() => prepare(row.id))}><ExternalLink size={14} />Prepare and send</button>}
        {['completed', 'SIGNED'].includes(row.status) && <>
          <button disabled={busy} onClick={() => setPreview({ requestId: row.id, audit: false })}><Eye size={14} />Preview signed PDF</button>
          <button disabled={busy} onClick={() => setPreview({ requestId: row.id, audit: true })}><Eye size={14} />Preview audit record</button>
          <button disabled={busy} onClick={() => void run(() => download(row.id, false))}><Download size={14} />Signed PDF</button>
          <button disabled={busy} onClick={() => void run(() => download(row.id, true))}><Download size={14} />Audit record</button>
        </>}
      </div>
    </section>)}
    </div>
  </Modal>
    {deleteId && <Modal open title="Delete signing record" onClose={() => {
      if (!busy) {
        setDeleteId(null)
      }
    }}>
      {requests.data?.find(row => row.id === deleteId)?.provider === IN_APP
        ? <p>Discard this in-app signing draft? Its placed fields and any drawn signatures are deleted. The original PDF is not changed.</p>
        : <p>Delete this NeedsReview record? This removes the local record only. It does not cancel or delete an agreement in DocuSign or Adobe. Check the provider account before creating a replacement.</p>}
      <div className="row signature-list-toolbar">
        <button disabled={busy} onClick={() => setDeleteId(null)}>Cancel</button>
        <button className="danger" disabled={busy} onClick={() => void run(async () => {
          await deleteSignatureRequest(id, deleteId)
          setDeleteId(null)
          clientRequestId.current = crypto.randomUUID()
        })}><Trash2 size={14} />Delete record</button>
      </div>
      {error && <ErrorBanner message={error} />}
    </Modal>}
    {editorId && <Suspense fallback={null}>
      <InAppSigningEditor attachmentId={id} requestId={editorId} name={name}
        onClose={() => {
          setEditorId(null)
          setRevision(value => value + 1)
        }}
        onCompleted={() => {
          const requestId = editorId
          setEditorId(null)
          setRevision(value => value + 1)
          setPreview({ requestId, audit: false })
        }} />
    </Suspense>}
    {preview && <PdfViewer
      key={`${preview.requestId}:${preview.audit}`}
      name={`${preview.audit ? 'audit' : 'signed'}-${name}`}
      sourceKey={`${id}:${preview.requestId}:${preview.audit}`}
      load={signal => downloadSignatureDocument(id, preview.requestId, preview.audit, signal)}
      onClose={() => setPreview(null)}
    />}
  </>
}
