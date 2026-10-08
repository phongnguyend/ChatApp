import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, RefreshCw, Trash2 } from 'lucide-react';
import { authFetch } from '../services/auth';

type Item = { id: string; fileName: string; sizeBytes: number; formTitle: string | null; expiresAt: string; ready: boolean; canDelete: boolean };
type Page = { items: Item[]; total: number; totalBytes: number; page: number; pageSize: number; canManageUnattributed: boolean };
const size = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function OrphanAttachmentsPanel({ apiUrl, username, hidden }: { apiUrl: string; username: string; hidden: boolean }) {
  const [data, setData] = useState<Page | null>(null);
  const [page, setPage] = useState(1);
  const [unattributed, setUnattributed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const query = `username=${encodeURIComponent(username)}&unattributed=${unattributed}`;
  useEffect(() => {
    if (hidden) {
      return;
    }
    const controller = new AbortController();
    window.dispatchEvent(new Event('documents-storage-changed'));
    setLoading(true);
    setError('');
    authFetch(`${apiUrl}/api/documents/orphan-attachments?${query}&page=${page}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) {
        throw new Error('Unable to load orphan attachments.');
      }
      const result = await response.json() as Page;
      if (!controller.signal.aborted) {
        setData(result);
      }
    }).catch(reason => {
      if (!controller.signal.aborted) {
        setError(reason.message);
      }
    }).finally(() => {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [apiUrl, query, page, revision, hidden]);
  async function remove(item: Item) {
    if (!window.confirm(`Permanently delete ${item.fileName}? This expired file can no longer be submitted.`)) {
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await authFetch(`${apiUrl}/api/documents/orphan-attachments/${item.id}?${query}`, { method: 'DELETE' });
      if (!response.ok) {
        const problem = await response.json().catch(() => ({}));
        throw new Error(problem.message ?? 'Unable to delete this attachment. Refresh and try again.');
      }
      setNotice(`${item.fileName} deleted.`);
      if (data?.items.length === 1 && page > 1) {
        setPage(page - 1);
      }
      setRevision(value => value + 1);
      window.dispatchEvent(new Event('documents-storage-changed'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Deletion failed.');
    } finally {
      setBusy(false);
    }
  }
  return <section className="documents-orphan-panel" aria-label="Orphan attachments">
    <div className="documents-toolbar"><div><h2>Orphan attachments</h2><p>Your uploads and anonymous uploads to your forms remain in your storage until deleted. Only expired uploads can be deleted. Files used in submitted responses are not listed here.</p></div><button type="button" disabled={busy || loading} onClick={() => { setRevision(value => value + 1); window.dispatchEvent(new Event('documents-storage-changed')); }}><RefreshCw size={16} />Refresh</button></div>
    {data?.canManageUnattributed && <label>Storage account <select aria-label="Attachment storage account" value={unattributed ? 'unattributed' : 'mine'} disabled={busy || loading} onChange={event => { setUnattributed(event.target.value === 'unattributed'); setPage(1); setNotice(''); }}><option value="mine">My storage</option><option value="unattributed">Unattributed legacy uploads</option></select></label>}
    {data && <p>{data.total} unsubmitted files · {size(data.totalBytes)} {unattributed ? 'without an identifiable storage owner' : 'counted toward your storage'}.</p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {loading ? <p role="status">Loading attachments…</p> : <div className="documents-orphan-list">{data?.items.map(item => <article key={item.id} className="documents-orphan-item"><FileText size={22} aria-hidden="true" /><div><strong>{item.fileName}</strong><small>{item.formTitle ?? 'Deleted form'} · {size(item.sizeBytes)} · {item.canDelete ? 'Expired / unused' : `${item.ready ? 'Awaiting response' : 'Upload incomplete'} — expires ${new Date(item.expiresAt).toLocaleString()}`}</small></div><button type="button" disabled={busy || !item.canDelete} title={item.canDelete ? 'Delete expired attachment' : 'Available after expiry; refresh to check'} aria-label={`Delete ${item.fileName}`} onClick={() => { void remove(item); }}><Trash2 size={16} />Delete</button></article>)}{data?.total === 0 && <p>No orphan attachments.</p>}</div>}
    {data && data.total > data.pageSize && <div className="documents-toolbar"><button type="button" disabled={busy || loading || page === 1} onClick={() => setPage(page - 1)}><ChevronLeft size={16} />Previous</button><span>Page {page}</span><button type="button" disabled={busy || loading || page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next<ChevronRight size={16} /></button></div>}
  </section>;
}
