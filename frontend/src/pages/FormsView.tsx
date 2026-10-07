import { useEffect, useState } from 'react';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, ClipboardList, Copy, Download, ExternalLink, Eye, ListChecks, LoaderCircle, PencilRuler, Plus, Redo2, RefreshCw, Save, Search, Send, Share2, Square, Trash2, Undo2, X } from 'lucide-react';
import { FormBuilder } from '../components/forms/FormBuilder';
import { FormSchemaDialog } from '../components/forms/FormSchemaDialog';
import { Braces } from 'lucide-react';
import { InvitationQrCode } from '../components/InvitationQrCode';
import { API_URL } from '../services/auth';
import { FormRenderer } from '../components/forms/FormRenderer';
import { FormsError, formsApi } from '../services/formsApi';
import { csvCell, definitionIssues, flatten, isQuestion, type FormDefinition, type FormDetail, type FormSummary, type ResponsePage } from '../components/forms/formModel';
import '../components/forms/Forms.css';

const formTabs = [
  { value: 'build', label: 'Build', icon: PencilRuler },
  { value: 'preview', label: 'Preview', icon: Eye },
  { value: 'responses', label: 'Responses', icon: ListChecks },
  { value: 'share', label: 'Share & settings', icon: Share2 },
] as const;

export function FormsView({ hidden, onBack }: { hidden: boolean; onBack: () => void }) {
  const [forms, setForms] = useState<FormSummary[]>([]);
  const [form, setForm] = useState<FormDetail | null>(null);
  const [draft, setDraft] = useState<FormDefinition | null>(null);
  const [past, setPast] = useState<FormDefinition[]>([]);
  const [future, setFuture] = useState<FormDefinition[]>([]);
  const [tab, setTab] = useState<'build' | 'preview' | 'responses' | 'share'>('build');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [responses, setResponses] = useState<ResponsePage | null>(null);
  const dirty = !!form && !!draft && JSON.stringify(form.definition) !== JSON.stringify(draft);
  const issues = draft ? definitionIssues(draft) : [];
  const shareUrl = form ? `${window.location.origin}${window.location.pathname}?form=${encodeURIComponent(form.shareToken)}` : '';

  useEffect(() => {
    if (hidden) {
      return;
    }
    let active = true;
    setLoading(true);
    formsApi<FormSummary[]>('forms/').then(items => {
      if (active) {
        setForms(items);
      }
    }).catch(reason => {
      if (active) {
        setError(reason.message);
      }
    }).finally(() => {
      if (active) {
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [hidden]);

  useEffect(() => {
    if (!dirty) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function report(reason: unknown) {
    const message = reason instanceof Error ? reason.message : 'Something went wrong. Please try again.';
    setError(reason instanceof FormsError ? [message, ...Object.values(reason.errors)].join(' ') : message);
  }
  async function run(action: () => Promise<void>) {
    if (busy) {
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (reason) {
      report(reason);
    } finally {
      setBusy(false);
    }
  }
  function open(detail: FormDetail) {
    setSchemaOpen(false);
    setForm(detail);
    setDraft(detail.definition);
    setPast([]);
    setFuture([]);
    setResponses(null);
    setTab('build');
  }
  function change(definition: FormDefinition) {
    if (draft) {
      setPast(history => [...history.slice(-49), draft]);
    }
    setFuture([]);
    setDraft(definition);
    setNotice('');
  }
  async function save() {
    if (!form || !draft) {
      throw new Error('No form selected.');
    }
    if (issues.length > 0) {
      throw new Error(issues.join(' '));
    }
    const result = dirty ? await formsApi<FormDetail>(`forms/${form.id}`, 'PUT', { revision: form.revision, definition: draft }) : form;
    setForm(result);
    setDraft(result.definition);
    return result;
  }
  async function loadResponses(page = 1) {
    if (form) {
      setResponses(await formsApi<ResponsePage>(`forms/${form.id}/responses?page=${page}`));
    }
  }
  async function exportCsv() {
    if (!form) {
      return;
    }
    const rows: string[][] = [['Response ID', 'Submitted at (UTC)', 'Version', 'Question ID', 'Question', 'Answer']];
    let page = 1;
    let count = 0;
    let total = 0;
    let snapshot = '';
    do {
      const result = await formsApi<ResponsePage>(`forms/${form.id}/responses?page=${page}${snapshot ? `&before=${encodeURIComponent(snapshot)}` : ''}`);
      snapshot = result.snapshot;
      total = result.total;
      count += result.items.length;
      for (const response of result.items) {
        for (const question of flatten(response.definition.nodes).filter(isQuestion)) {
          if (Object.hasOwn(response.answers, question.id)) {
            rows.push([response.id, response.submittedAt, String(response.version), question.id, question.label, response.answers[question.id].join('; ')]);
          }
        }
      }
      if (result.items.length === 0) {
        break;
      }
      page++;
    } while (count < total);
    const blob = new Blob(['\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${form.title.replace(/[^a-zA-Z0-9_-]/g, '_') || 'form'}-responses.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`Exported ${count} responses.`);
  }
  async function backToList() {
    if (dirty && !window.confirm('Discard unsaved changes and return to your forms?')) {
      return;
    }
    setForm(null);
    setDraft(null);
    setForms(await formsApi<FormSummary[]>('forms/'));
  }
  if (hidden) {
    return null;
  }
  return <section className={`forms-view forms-scope${form && tab === 'build' ? ' forms-view-building' : ''}`} aria-label="Forms">
    <header className={`forms-header${form ? ' forms-header-editor' : ''}`}><button type="button" className="forms-icon-button" disabled={busy} aria-label={form ? 'Back to forms' : 'Back to chat'} onClick={() => {
      if (form) {
        void run(backToList);
      } else {
        onBack();
      }
    }}><ArrowLeft size={19} /></button>
      <div><span className="forms-eyebrow">CHATAPP FORMS</span><h1>{form ? draft?.title || 'Untitled form' : 'Your forms'}</h1><p>{form ? `${form.isPublished ? `Live · Version ${form.publishedVersion}` : form.publishedVersion ? 'Closed' : 'Draft'} · ${dirty ? 'Unsaved changes' : 'All changes saved'}` : 'Ask better questions. Bring every response together.'}</p></div>
      {form ? <div className="forms-actions"><button type="button" disabled={busy || past.length === 0} aria-label="Undo" onClick={() => {
        if (draft && past.length > 0) {
          setFuture(history => [draft, ...history]);
          setDraft(past[past.length - 1]);
          setPast(history => history.slice(0, -1));
        }
      }}><Undo2 size={16} /></button><button type="button" disabled={busy || future.length === 0} aria-label="Redo" onClick={() => {
        if (draft && future.length > 0) {
          setPast(history => [...history, draft]);
          setDraft(future[0]);
          setFuture(history => history.slice(1));
        }
      }}><Redo2 size={16} /></button><button type="button" disabled={busy || !dirty} onClick={() => { void run(async () => { await save(); setNotice('Draft saved.'); }); }}><Save size={16} aria-hidden="true" />Save draft</button><button className="forms-primary" type="button" disabled={busy} onClick={() => { void run(async () => {
        const saved = await save();
        const published = await formsApi<FormDetail>(`forms/${saved.id}/publish`, 'POST', { revision: saved.revision });
        setForm(published);
        setTab('share');
        setNotice(`Version ${published.publishedVersion} published. Your share link is ready.`);
      }); }}>{busy ? <LoaderCircle size={16} className="forms-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}{busy ? 'Working…' : form.isPublished ? 'Publish changes' : 'Publish form'}</button></div>
        : <button className="forms-primary" type="button" disabled={busy} onClick={() => { void run(async () => open(await formsApi<FormDetail>('forms/', 'POST'))); }}><Plus size={17} />New form</button>}
      {form && draft && <button type="button" disabled={busy} title="View JSON schema" aria-label="View JSON schema" onClick={() => setSchemaOpen(true)}><Braces size={16} aria-hidden="true" />JSON</button>}
    </header>
    {error && <div role="alert" className="forms-banner forms-error">{error}<button type="button" onClick={() => setError('')}><X size={16} aria-hidden="true" />Dismiss</button>{form && <button type="button" disabled={busy} onClick={() => {
      if (!dirty || window.confirm('Reload this form and discard unsaved changes?')) {
        void run(async () => open(await formsApi<FormDetail>(`forms/${form.id}`)));
      }
    }}><RefreshCw size={16} aria-hidden="true" />Reload saved form</button>}</div>}
    {notice && <div role="status" className="forms-banner"><Check size={16} />{notice}</div>}
    {!form ? <div className="forms-library"><div className="forms-library-toolbar"><label className="forms-search"><Search size={17} /><input aria-label="Search forms" placeholder="Search forms…" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="Filter forms" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All forms</option><option value="live">Published</option><option value="draft">Drafts</option><option value="closed">Closed</option></select><button type="button" disabled={busy} onClick={() => { void run(async () => setForms(await formsApi<FormSummary[]>('forms/'))); }}><RefreshCw size={16} aria-hidden="true" />Refresh</button></div>
      {loading && <p role="status">Loading your forms…</p>}
      {!loading && forms.length === 0 && <div className="forms-empty"><ClipboardList size={44} /><h2>A place for every question</h2><p>Create a survey, registration form, or feedback questionnaire. Arrange it your way and share a link.</p></div>}
      <div className="forms-grid">{forms.filter(item => item.title.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || filter === 'live' && item.isPublished || filter === 'draft' && item.publishedVersion === 0 || filter === 'closed' && !item.isPublished && item.publishedVersion > 0)).map(item => <article className="forms-card" key={item.id}><div className="forms-card-art"><ClipboardList size={32} /><span className={`forms-badge ${item.isPublished ? 'live' : ''}`}>{item.isPublished ? 'Published' : item.publishedVersion ? 'Closed' : 'Draft'}</span></div><button type="button" className="forms-card-title" disabled={busy} onClick={() => { void run(async () => open(await formsApi<FormDetail>(`forms/${item.id}`))); }}><h2>{item.title}</h2><p>{item.responseCount} responses · Updated {new Date(item.updatedAt).toLocaleDateString()}</p></button><div className="forms-card-actions"><button type="button" disabled={busy} onClick={() => { void run(async () => open(await formsApi<FormDetail>(`forms/${item.id}/duplicate`, 'POST'))); }}><Copy size={14} />Duplicate</button><button type="button" className="forms-danger" disabled={busy} onClick={() => {
        if (window.confirm(`Permanently delete “${item.title}” and all ${item.responseCount} responses?`)) {
          void run(async () => { await formsApi(`forms/${item.id}?revision=${item.revision}`, 'DELETE'); setForms(current => current.filter(value => value.id !== item.id)); });
        }
      }}><Trash2 size={14} aria-hidden="true" />Delete</button></div></article>)}</div>
    </div> : <>
      <nav className="forms-tabs" aria-label="Form editor">{formTabs.map(({ value, label, icon: Icon }) => <button type="button" key={value} disabled={busy} aria-current={tab === value ? 'page' : undefined} onClick={() => {
        setTab(value);
        setNotice('');
        if (value === 'responses') {
          void run(() => loadResponses());
        }
      }}><Icon size={16} aria-hidden="true" />{label}</button>)}</nav>
      {tab === 'build' && draft && <>{issues.length > 0 && <div className="forms-banner forms-warning">{issues.map((issue, index) => <p key={index}>{issue}</p>)}</div>}<fieldset className="forms-editor-fieldset" disabled={busy}><FormBuilder definition={draft} onChange={change} /></fieldset></>}
      {tab === 'preview' && draft && <div className="forms-preview"><FormRenderer definition={draft} preview onSubmit={() => setNotice(`Preview passed. ${draft.confirmationMessage || 'Thank you!'}`)} /></div>}
      {tab === 'share' && <div className="forms-settings"><h2>Share your form</h2><p>{form.isPublished ? 'Anyone with this link can submit a response. No sign-in is required.' : 'Publish this form to start accepting responses at this link.'}</p><label>Response link<input readOnly value={shareUrl} onFocus={event => event.target.select()} /></label><div className="forms-actions"><button type="button" disabled={busy} onClick={() => { void run(async () => { await navigator.clipboard.writeText(shareUrl); setNotice('Link copied.'); }); }}><Copy size={16} />Copy link</button>{form.isPublished && <a href={shareUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} />Open live form</a>}</div><section className="forms-share-qr" aria-label="Share with QR code"><h3>Scan to open this form</h3><p>Share this code on a screen or download it for print. It uses the same response link above.</p><InvitationQrCode src={`${API_URL}/api/forms/${form.id}/qr-code?baseUrl=${encodeURIComponent(window.location.origin + window.location.pathname)}`} alt={`QR code for ${form.title}`} linkLabel="response link" downloadName={`form-${form.id}-qr.png`} /></section><hr /><h3>Publishing</h3><p>Draft edits stay private until you publish. Each publication keeps a snapshot of its questions so earlier responses retain their original context.</p>{form.isPublished && <button type="button" disabled={busy} onClick={() => { void run(async () => { setForm(await formsApi<FormDetail>(`forms/${form.id}/close`, 'POST', { revision: form.revision })); setNotice('Form closed. Existing responses are preserved.'); }); }}><Square size={16} aria-hidden="true" />Stop accepting responses</button>}<hr /><h3>Make a copy</h3><p>Duplicate the saved draft as a new unpublished form. Responses are not copied.</p><button type="button" disabled={busy || dirty} onClick={() => { void run(async () => open(await formsApi<FormDetail>(`forms/${form.id}/duplicate`, 'POST'))); }}><Copy size={16} aria-hidden="true" />Duplicate form</button></div>}
      {tab === 'responses' && <div className="forms-responses"><div className="forms-response-header"><div><h2>{responses?.total ?? '…'} responses</h2><p>Answers are shown with the questions from the submitted version.</p></div><div className="forms-actions"><button type="button" disabled={busy} onClick={() => { void run(() => loadResponses(responses?.page)); }}><RefreshCw size={16} aria-hidden="true" />Refresh</button><button type="button" disabled={busy || !responses?.total} onClick={() => { void run(exportCsv); }}><Download size={16} />Export CSV</button></div></div>
        {responses?.total === 0 && <div className="forms-empty"><ClipboardList size={38} /><h3>No responses yet</h3><p>Publish your form and share its link to start collecting answers.</p></div>}
        {responses?.items.map(response => <details className="forms-response" key={response.id}><summary><strong>{new Date(response.submittedAt).toLocaleString()}</strong><span>Version {response.version} · {Object.values(response.answers).filter(values => values.length > 0).length} answered</span></summary><dl>{flatten(response.definition.nodes).filter(node => isQuestion(node) && Object.hasOwn(response.answers, node.id)).map(node => <div key={node.id}><dt>{node.label}</dt><dd>{response.answers[node.id].join(', ') || 'No answer'}</dd></div>)}</dl><small>Response ID: {response.id}</small></details>)}
        {responses && responses.total > responses.pageSize && <div className="forms-pagination"><button type="button" disabled={busy || responses.page <= 1} onClick={() => { void run(() => loadResponses(responses.page - 1)); }}><ChevronLeft size={16} aria-hidden="true" />Previous</button><span>Page {responses.page} of {Math.ceil(responses.total / responses.pageSize)}</span><button type="button" disabled={busy || responses.page * responses.pageSize >= responses.total} onClick={() => { void run(() => loadResponses(responses.page + 1)); }}>Next<ChevronRight size={16} aria-hidden="true" /></button></div>}
      </div>}
    </>}
    {schemaOpen && draft && <FormSchemaDialog definition={draft} onClose={() => setSchemaOpen(false)} />}
  </section>;
}
