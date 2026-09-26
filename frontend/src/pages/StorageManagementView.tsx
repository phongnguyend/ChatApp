import { authFetch as fetch } from "../services/auth";
import { ArrowLeft, HardDrive, LoaderCircle, Pencil, Search, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "./StorageManagementView.css";

type StorageUser = {
  id: string;
  username: string;
  displayName: string;
  status: string;
  usedBytes: number;
  reservedBytes: number;
  limitBytes: number;
  customLimitBytes: number | null;
};
type StoragePage = {
  items: StorageUser[];
  totalCount: number;
  hasMore: boolean;
  defaultLimitBytes: number;
  userCount: number;
  totalUsedBytes: number;
};

const gib = 1024 ** 3;
const maxLimitBytes = 100 * 1024 ** 4;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  do { value /= 1024; unit += 1; } while (value >= 1024 && unit < units.length - 1);
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`;
}

async function responseError(response: Response) {
  try {
    const body = await response.json() as { message?: string };
    if (body.message) return body.message;
  } catch { /* Use the status below. */ }
  return `Request failed (${response.status}).`;
}

export function StorageManagementView({ apiUrl, currentUsername, onBack, hidden }: {
  apiUrl: string;
  currentUsername: string;
  onBack: () => void;
  hidden: boolean;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<StorageUser[]>([]);
  const [page, setPage] = useState<StoragePage | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [editError, setEditError] = useState("");
  const [editing, setEditing] = useState<StorageUser | null>(null);
  const [limitGiB, setLimitGiB] = useState("");
  const [saving, setSaving] = useState(false);
  const moreRequest = useRef<AbortController | null>(null);
  const baseUrl = `${apiUrl}/api/documents/storage-management?username=${encodeURIComponent(currentUsername)}`;

  useEffect(() => {
    if (hidden) return;
    const controller = new AbortController();
    moreRequest.current?.abort();
    setLoading(true);
    setError("");
    setItems([]);
    setPage(null);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${baseUrl}&query=${encodeURIComponent(query.trim())}&offset=0`, { signal: controller.signal });
        if (!response.ok) throw new Error(await responseError(response));
        const result = await response.json() as StoragePage;
        if (!controller.signal.aborted) { setItems(result.items); setPage(result); }
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load storage usage.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, query.trim() ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); moreRequest.current?.abort(); };
  }, [baseUrl, query, hidden]);

  async function loadMore() {
    if (!page?.hasMore || loading || loadingMore) return;
    const controller = new AbortController();
    moreRequest.current = controller;
    setLoadingMore(true);
    setError("");
    try {
      const response = await fetch(`${baseUrl}&query=${encodeURIComponent(query.trim())}&offset=${items.length}`, { signal: controller.signal });
      if (!response.ok) throw new Error(await responseError(response));
      const next = await response.json() as StoragePage;
      if (!controller.signal.aborted) { setItems((current) => [...current, ...next.items]); setPage(next); }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load more users.");
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }

  function beginEdit(user: StorageUser) {
    setEditing(user);
    setLimitGiB(((user.customLimitBytes ?? user.limitBytes) / gib).toFixed(2).replace(/\.00$/, ""));
    setEditError("");
  }

  async function saveLimit(reset = false) {
    if (!editing || saving) return;
    const value = Number(limitGiB);
    const limitBytes = reset ? null : Math.round(value * gib);
    if (!reset && (!Number.isFinite(value) || limitBytes === null || limitBytes < 1 || limitBytes > maxLimitBytes)) {
      setEditError("Enter a limit greater than zero and no more than 100 TB.");
      return;
    }
    setSaving(true);
    setEditError("");
    try {
      const response = await fetch(`${apiUrl}/api/documents/storage-management/${editing.id}/limit?username=${encodeURIComponent(currentUsername)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limitBytes }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const updated = await response.json() as { limitBytes: number; documentStorageLimitBytes: number | null };
      setItems((current) => current.map((user) => user.id === editing.id
        ? { ...user, limitBytes: updated.limitBytes, customLimitBytes: updated.documentStorageLimitBytes }
        : user));
      setEditing(null);
      window.dispatchEvent(new Event("documents-storage-changed"));
    } catch (reason) {
      setEditError(reason instanceof Error ? reason.message : "Could not update the storage limit.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="storage-management-view" aria-label="Storage management" hidden={hidden}>
    <header className="storage-management-header">
      <div><p className="eyebrow">Documents</p><h1>Storage management</h1><p>View document storage usage and set limits for each user.</p></div>
      <button type="button" onClick={onBack}><ArrowLeft size={16} /> Back to chat</button>
    </header>
    <div className="storage-management-summary">
      <div><Users size={18} /><span><small>Users</small><strong>{page ? page.userCount.toLocaleString() : "—"}</strong></span></div>
      <div><HardDrive size={18} /><span><small>Total used</small><strong>{page ? formatBytes(page.totalUsedBytes) : "—"}</strong></span></div>
      <div><span><small>Default limit per user</small><strong>{page ? formatBytes(page.defaultLimitBytes) : "—"}</strong></span></div>
    </div>
    <div className="storage-management-toolbar">
      <strong>{page ? `${page.totalCount.toLocaleString()} matching ${page.totalCount === 1 ? "user" : "users"}` : "Users"}</strong>
      <label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} placeholder="Search users" aria-label="Search users" /></label>
    </div>
    {error && <p className="storage-management-error" role="alert">{error}</p>}
    <div className="storage-management-table" role="table" aria-label="User storage usage">
      <div className="storage-management-row storage-management-table-header" role="row"><span role="columnheader">User</span><span role="columnheader">Storage used</span><span role="columnheader">Limit</span><span role="columnheader">Available</span><span role="columnheader">Action</span></div>
      {loading && <p className="storage-management-state"><LoaderCircle className="spin" size={18} /> Loading storage usage…</p>}
      {!loading && !error && items.length === 0 && <p className="storage-management-state">{query ? "No matching users." : "No users yet."}</p>}
      {!loading && items.map((user) => {
        const percentage = Math.min(100, Math.round(user.usedBytes / user.limitBytes * 100));
        return <div className="storage-management-row" role="row" key={user.id}>
          <div role="cell" className="storage-management-user"><strong>{user.displayName}</strong><small>@{user.username}{user.status !== "active" ? ` · ${user.status}` : ""}</small></div>
          <div role="cell" className="storage-management-used"><span>{formatBytes(user.usedBytes)} <small>({percentage}%)</small></span><div className="storage-management-track" role="progressbar" aria-label={`${user.displayName} storage used`} aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${percentage}%` }} /></div>{user.reservedBytes > 0 && <small>{formatBytes(user.reservedBytes)} in uploads</small>}</div>
          <div role="cell" className="storage-management-limit">{formatBytes(user.limitBytes)}<small>{user.customLimitBytes === null ? "Default" : "Custom"}</small></div>
          <div role="cell" className={user.usedBytes + user.reservedBytes > user.limitBytes ? "storage-management-over" : ""}>{user.usedBytes + user.reservedBytes > user.limitBytes ? `${formatBytes(user.usedBytes + user.reservedBytes - user.limitBytes)} over limit` : formatBytes(user.limitBytes - user.usedBytes - user.reservedBytes)}</div>
          <div role="cell"><button type="button" className="storage-management-edit" onClick={() => beginEdit(user)}><Pencil size={15} /> Set limit</button></div>
        </div>;
      })}
    </div>
    {page?.hasMore && !loading && <button className="storage-management-more" type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Load more users"}</button>}
    {editing && <div className="storage-management-backdrop"><form className="storage-management-dialog" role="dialog" aria-modal="true" aria-labelledby="storage-limit-title" onSubmit={(event) => { event.preventDefault(); void saveLimit(); }}>
      <div className="storage-management-dialog-heading"><h2 id="storage-limit-title">Storage limit for {editing.displayName}</h2><button type="button" aria-label="Close" onClick={() => setEditing(null)} disabled={saving}><X size={18} /></button></div>
      <p>Current usage: {formatBytes(editing.usedBytes)}. The default limit is {formatBytes(page?.defaultLimitBytes ?? editing.limitBytes)}.</p>
      <label htmlFor="storage-limit-gib">Limit (GB)</label>
      <input id="storage-limit-gib" type="number" min="0.01" max="102400" step="0.01" value={limitGiB} onChange={(event) => setLimitGiB(event.target.value)} required autoFocus />
      {limitGiB && Number(limitGiB) * gib < editing.usedBytes && <p className="storage-management-warning">This is below current usage. New uploads will be blocked until usage falls below the limit.</p>}
      {editError && <p className="storage-management-error" role="alert">{editError}</p>}
      <div className="storage-management-dialog-actions">{editing.customLimitBytes !== null && <button type="button" onClick={() => void saveLimit(true)} disabled={saving}>Use default</button>}<button type="button" onClick={() => setEditing(null)} disabled={saving}>Cancel</button><button type="submit" disabled={saving}>{saving ? "Saving…" : "Save limit"}</button></div>
    </form></div>}
  </section>;
}
