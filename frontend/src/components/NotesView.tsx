import { ArrowLeft, FileText, LoaderCircle, NotebookPen, Pencil, Pin, PinOff, Plus, Search, Share2, Trash2, Users, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import "./NotesView.css";

type UserNote = {
  id: string;
  title: string;
  content: string;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
  ownerUsername: string;
  ownerDisplayName: string;
  permission: "owner" | "viewer" | "editor";
  shareCount: number;
};
type NoteDraft = { title: string; content: string };
type Person = { id: string; username: string; displayName: string };
type NoteShare = { id: string; username: string; displayName: string; permission: "viewer" | "editor" };

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const formatDateTime = (value: string) => dateTimeFormatter.format(new Date(value));

async function readError(response: Response) {
  const body = await response.json().catch(() => null) as { message?: string } | null;
  return body?.message || `Request failed (${response.status}).`;
}

export function NotesView({ apiUrl, currentUsername, onBack, openTarget, hidden }: {
  apiUrl: string;
  currentUsername: string;
  onBack: () => void;
  openTarget?: { id: string; request: number } | null;
  hidden: boolean;
}) {
  const endpoint = `${apiUrl}/api/user-notes?username=${encodeURIComponent(currentUsername)}`;
  const [notes, setNotes] = useState<UserNote[]>([]);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"mine" | "shared" | "outgoing">("mine");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [viewing, setViewing] = useState<UserNote | null>(null);
  const [editing, setEditing] = useState<UserNote | null>(null);
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserNote | null>(null);
  const [sharing, setSharing] = useState<UserNote | null>(null);
  const [shares, setShares] = useState<NoteShare[]>([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareSaving, setShareSaving] = useState(false);
  const [shareError, setShareError] = useState("");
  const [peopleQuery, setPeopleQuery] = useState("");
  const [peopleResults, setPeopleResults] = useState<Person[]>([]);
  const [recipient, setRecipient] = useState<Person | null>(null);
  const [newPermission, setNewPermission] = useState<"viewer" | "editor">("viewer");

  useEffect(() => {
    if (hidden || !openTarget) return;
    const controller = new AbortController();
    setDialogError("");
    fetch(`${apiUrl}/api/user-notes/${openTarget.id}?username=${encodeURIComponent(currentUsername)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return response.json() as Promise<UserNote>;
      })
      .then((note) => {
        if (controller.signal.aborted) return;
        setNotes((current) => [note, ...current.filter((item) => item.id !== note.id)]);
        setMode(note.permission === "owner" ? "mine" : "shared");
        setQuery("");
        setViewing(note);
      })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not open note."); });
    return () => controller.abort();
  }, [apiUrl, currentUsername, hidden, openTarget]);

  useEffect(() => {
    if (hidden) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(endpoint, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return response.json() as Promise<UserNote[]>;
      })
      .then((items) => { if (!controller.signal.aborted) setNotes(items); })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load notes."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, hidden, mode]);

  const sharingId = sharing?.id;
  useEffect(() => {
    if (!sharingId || hidden) return;
    const controller = new AbortController();
    setShareLoading(true);
    setShareError("");
    fetch(`${apiUrl}/api/user-notes/${sharingId}/shares?username=${encodeURIComponent(currentUsername)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return response.json() as Promise<NoteShare[]>;
      })
      .then((items) => { if (!controller.signal.aborted) setShares(items); })
      .catch((reason) => { if (!controller.signal.aborted) setShareError(reason instanceof Error ? reason.message : "Could not load sharing."); })
      .finally(() => { if (!controller.signal.aborted) setShareLoading(false); });
    return () => controller.abort();
  }, [apiUrl, currentUsername, hidden, sharingId]);

  useEffect(() => {
    if (!sharingId || !peopleQuery.trim() || recipient) { setPeopleResults([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`${apiUrl}/api/users?currentUsername=${encodeURIComponent(currentUsername)}&query=${encodeURIComponent(peopleQuery.trim())}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(await readError(response));
          return response.json() as Promise<Person[]>;
        })
        .then((items) => { if (!controller.signal.aborted) setPeopleResults(items); })
        .catch((reason) => { if (!controller.signal.aborted) setShareError(reason instanceof Error ? reason.message : "Could not search people."); });
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [apiUrl, currentUsername, sharingId, peopleQuery, recipient]);

  function beginCreate() {
    setMode("mine");
    setViewing(null);
    setEditing(null);
    setDraft({ title: "", content: "" });
    setDialogError("");
  }

  function beginEdit(note: UserNote) {
    if (note.permission === "viewer") return;
    setViewing(null);
    setEditing(note);
    setDraft({ title: note.title, content: note.content });
    setDialogError("");
  }

  function openShare(note: UserNote) {
    if (note.permission !== "owner") return;
    setViewing(null);
    setSharing(note);
    setShares([]);
    setShareError("");
    setPeopleQuery("");
    setPeopleResults([]);
    setRecipient(null);
    setNewPermission("viewer");
  }

  function updateShareCount(noteId: string, count: number) {
    setNotes((current) => current.map((note) => note.id === noteId ? { ...note, shareCount: count } : note));
  }

  async function putShare(recipientUsername: string, permission: "viewer" | "editor") {
    if (!sharing || shareSaving) return;
    setShareSaving(true);
    setShareError("");
    try {
      const response = await fetch(`${apiUrl}/api/user-notes/${sharing.id}/shares?username=${encodeURIComponent(currentUsername)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientUsername, permission }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const updated = await response.json() as NoteShare;
      const existed = shares.some((item) => item.id === updated.id);
      setShares((current) => [...current.filter((item) => item.id !== updated.id), updated]
        .sort((a, b) => a.displayName.localeCompare(b.displayName)));
      if (!existed) updateShareCount(sharing.id, shares.length + 1);
      setRecipient(null);
      setPeopleQuery("");
    } catch (reason) { setShareError(reason instanceof Error ? reason.message : "Could not update sharing."); }
    finally { setShareSaving(false); }
  }

  async function removeShare(share: NoteShare) {
    if (!sharing || shareSaving) return;
    setShareSaving(true);
    setShareError("");
    try {
      const response = await fetch(`${apiUrl}/api/user-notes/${sharing.id}/shares/${share.id}?username=${encodeURIComponent(currentUsername)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readError(response));
      setShares((current) => current.filter((item) => item.id !== share.id));
      updateShareCount(sharing.id, shares.length - 1);
    } catch (reason) { setShareError(reason instanceof Error ? reason.message : "Could not remove access."); }
    finally { setShareSaving(false); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || busy) return;
    if (!draft.title.trim()) { setDialogError("Enter a note title."); return; }
    setBusy(true);
    setDialogError("");
    try {
      const response = await fetch(editing ? `${apiUrl}/api/user-notes/${editing.id}?username=${encodeURIComponent(currentUsername)}` : endpoint, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: draft.title.trim(), content: draft.content }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const note = await response.json() as UserNote;
      setNotes((current) => editing ? current.map((item) => item.id === note.id ? note : item) : [note, ...current]);
      setDraft(null);
      setEditing(null);
      setViewing(note);
    } catch (reason) {
      setDialogError(reason instanceof Error ? reason.message : "Could not save note.");
    } finally { setBusy(false); }
  }

  async function togglePin(note: UserNote) {
    if (busy) return;
    setBusy(true);
    setError("");
    setDialogError("");
    try {
      const response = await fetch(`${apiUrl}/api/user-notes/${note.id}/pin?username=${encodeURIComponent(currentUsername)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPinned: !note.isPinned }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const updated = await response.json() as UserNote;
      setNotes((current) => current.map((item) => item.id === updated.id ? updated : item));
      setViewing((current) => current?.id === updated.id ? updated : current);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Could not update note.";
      if (viewing?.id === note.id) setDialogError(message);
      else setError(message);
    }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!deleteTarget || busy) return;
    setBusy(true);
    setDialogError("");
    try {
      const response = await fetch(`${apiUrl}/api/user-notes/${deleteTarget.id}?username=${encodeURIComponent(currentUsername)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readError(response));
      setNotes((current) => current.filter((item) => item.id !== deleteTarget.id));
      setViewing((current) => current?.id === deleteTarget.id ? null : current);
      setDeleteTarget(null);
    } catch (reason) { setDialogError(reason instanceof Error ? reason.message : "Could not delete note."); }
    finally { setBusy(false); }
  }

  const searched = notes.filter((note) =>
    (mode === "mine" ? note.permission === "owner" : mode === "shared" ? note.permission !== "owner" : note.permission === "owner" && note.shareCount > 0) &&
    `${note.title}\n${note.content}\n${note.ownerDisplayName}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const visible = [...searched].sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));

  return <section className="notes-view" hidden={hidden} aria-label="Notes">
    <header className="notes-header">
      <div><p className="eyebrow">YOUR IDEAS</p><h1>Notes</h1><p>Capture ideas and keep important notes close.</p></div>
      <div className="notes-header-actions"><button type="button" onClick={onBack}><ArrowLeft size={16} /> Back to chat</button><button className="notes-primary" type="button" onClick={beginCreate}><Plus size={17} /> New note</button></div>
    </header>
    <div className="notes-tabs" role="tablist" aria-label="Note sections">
      <button type="button" role="tab" aria-selected={mode === "mine"} onClick={() => { setQuery(""); setMode("mine"); }}><NotebookPen size={15} aria-hidden="true" /> My notes</button>
      <button type="button" role="tab" aria-selected={mode === "shared"} onClick={() => { setQuery(""); setMode("shared"); }}><Users size={15} aria-hidden="true" /> Shared with me</button>
      <button type="button" role="tab" aria-selected={mode === "outgoing"} onClick={() => { setQuery(""); setMode("outgoing"); }}><Share2 size={15} aria-hidden="true" /> Shared by me</button>
    </div>
    <div className="notes-toolbar"><label><Search size={17} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes" aria-label="Search notes" /></label><span>{visible.length} {visible.length === 1 ? "note" : "notes"}</span></div>
    {error && <p className="notes-error" role="alert">{error}</p>}
    <div className="notes-list">
      {loading ? <div className="notes-empty"><LoaderCircle className="notes-spin" size={25} /> Loading notes...</div> : visible.length === 0 ? <div className="notes-empty"><FileText size={36} /><strong>{query ? "No matching notes" : mode === "shared" ? "Nothing shared with you" : mode === "outgoing" ? "No shared notes yet" : "No notes yet"}</strong><span>{query ? "Try another search." : mode === "shared" ? "Notes others share with you appear here." : mode === "outgoing" ? "Share a note to see it here." : "Create a note to get started."}</span></div> :
        visible.map((note) => <article className="notes-card" key={note.id}>
          <button className="notes-card-main" type="button" onClick={() => { setDialogError(""); setViewing(note); }} aria-label={`View ${note.title}`}><span className="notes-card-heading"><strong>{note.title}</strong>{note.isPinned && <span className="notes-pin-indicator"><Pin size={13} /> Pinned</span>}</span><span className="notes-card-preview">{note.content || "No content"}</span></button>
          {note.permission !== "owner" && <div className="notes-card-access">Shared by {note.ownerDisplayName} · {note.permission === "editor" ? "Can edit" : "Can view"}</div>}
          {note.permission === "owner" && note.shareCount > 0 && <div className="notes-card-access">Shared with {note.shareCount} {note.shareCount === 1 ? "person" : "people"}</div>}
          <div className="notes-card-timestamps"><span>Created <time dateTime={note.createdAt}>{formatDateTime(note.createdAt)}</time></span><span>Updated <time dateTime={note.updatedAt}>{formatDateTime(note.updatedAt)}</time></span></div>
          <div className="notes-card-actions">{note.permission === "owner" && <button type="button" disabled={busy} onClick={() => void togglePin(note)}>{note.isPinned ? <PinOff size={15} /> : <Pin size={15} />}{note.isPinned ? "Unpin" : "Pin"}</button>}{note.permission !== "viewer" && <button type="button" disabled={busy} onClick={() => beginEdit(note)}><Pencil size={15} /> Edit</button>}{note.permission === "owner" && <><button type="button" disabled={busy} onClick={() => openShare(note)}><Share2 size={15} /> Share</button><button type="button" disabled={busy} onClick={() => { setDialogError(""); setDeleteTarget(note); }}><Trash2 size={15} /> Delete</button></>}</div>
        </article>)}
    </div>
    {viewing && !draft && !deleteTarget && <div className="notes-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewing(null); }}>
      <div className="notes-dialog notes-detail" role="dialog" aria-modal="true" aria-labelledby="notes-detail-title">
        <header><div><p className="eyebrow">Note</p><h2 id="notes-detail-title">{viewing.title}</h2></div><button type="button" aria-label="Close note" onClick={() => setViewing(null)}><X size={19} /></button></header>
        {viewing.permission !== "owner" && <p className="notes-card-access">Shared by {viewing.ownerDisplayName} · {viewing.permission === "editor" ? "Can edit" : "Can view"}</p>}
        <div className="notes-detail-meta"><span>Created <time dateTime={viewing.createdAt}>{formatDateTime(viewing.createdAt)}</time></span><span>Updated <time dateTime={viewing.updatedAt}>{formatDateTime(viewing.updatedAt)}</time></span></div>
        <div className="notes-detail-content">{viewing.content || <span className="notes-placeholder">No content</span>}</div>
        {dialogError && <p className="notes-error" role="alert">{dialogError}</p>}
        <footer>
          {viewing.permission === "owner" && <button type="button" disabled={busy} onClick={() => void togglePin(viewing)}>{viewing.isPinned ? <PinOff size={15} /> : <Pin size={15} />}{viewing.isPinned ? "Unpin" : "Pin"}</button>}
          {viewing.permission !== "viewer" && <button type="button" onClick={() => beginEdit(viewing)}><Pencil size={15} /> Edit</button>}
          {viewing.permission === "owner" && <><button type="button" onClick={() => openShare(viewing)}><Share2 size={15} /> Share</button><button type="button" onClick={() => { setDialogError(""); setDeleteTarget(viewing); }}><Trash2 size={15} /> Delete</button></>}
          <button type="button" onClick={() => setViewing(null)}>Close</button>
        </footer>
      </div>
    </div>}
    {sharing && <div className="notes-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !shareSaving) setSharing(null); }}>
      <div className="notes-dialog notes-share" role="dialog" aria-modal="true" aria-labelledby="notes-share-title">
        <header><h2 id="notes-share-title">Share “{sharing.title}”</h2><button type="button" aria-label="Close sharing" disabled={shareSaving} onClick={() => setSharing(null)}><X size={19} /></button></header>
        <label>Add a person<input value={peopleQuery} onChange={(event) => { setPeopleQuery(event.target.value); setRecipient(null); setShareError(""); }} placeholder="Search name or username" autoComplete="off" /></label>
        {!recipient && peopleQuery.trim() && peopleResults.length > 0 && <div className="notes-people-results" role="listbox" aria-label="People">
          {peopleResults.map((person) => <button type="button" role="option" aria-selected={false} key={person.id} onClick={() => { setRecipient(person); setPeopleQuery(`${person.displayName} (@${person.username})`); setPeopleResults([]); }}>{person.displayName} <small>@{person.username}</small></button>)}
        </div>}
        <div className="notes-share-add"><label>Permission<select value={newPermission} onChange={(event) => setNewPermission(event.target.value as "viewer" | "editor")}><option value="viewer">Viewer — can view</option><option value="editor">Editor — can view and edit</option></select></label><button className="notes-primary" type="button" disabled={!recipient || shareLoading || shareSaving} onClick={() => { if (recipient) void putShare(recipient.username, newPermission); }}>{shareSaving ? "Saving..." : "Share"}</button></div>
        <div className="notes-share-list"><strong>People with access</strong>
          {shareLoading ? <p>Loading access...</p> : shares.length === 0 ? <p>Only you have access.</p> : shares.map((share) => <div className="notes-share-person" key={share.id}><span>{share.displayName}<small>@{share.username}</small></span><select aria-label={`Permission for ${share.displayName}`} value={share.permission} disabled={shareSaving} onChange={(event) => void putShare(share.username, event.target.value as "viewer" | "editor")}><option value="viewer">Viewer</option><option value="editor">Editor</option></select><button type="button" disabled={shareSaving} onClick={() => void removeShare(share)}>Remove</button></div>)}
        </div>
        {shareError && <p className="notes-error" role="alert">{shareError}</p>}
        <footer><button type="button" disabled={shareSaving} onClick={() => setSharing(null)}>Close</button></footer>
      </div>
    </div>}
    {draft && <div className="notes-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setDraft(null); }}><form className="notes-dialog notes-editor" onSubmit={(event) => void save(event)} aria-label={editing ? "Edit note" : "New note"}><header><h2>{editing ? "Edit note" : "New note"}</h2><button type="button" aria-label="Close" disabled={busy} onClick={() => setDraft(null)}><X size={19} /></button></header><label>Title<input autoFocus required maxLength={200} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Note title" /></label><label>Content<textarea rows={12} maxLength={20000} value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} placeholder="Write your note..." /></label><small>{draft.content.length.toLocaleString()} / 20,000 characters</small>{dialogError && <p className="notes-error" role="alert">{dialogError}</p>}<footer><button type="button" disabled={busy} onClick={() => setDraft(null)}>Cancel</button><button className="notes-primary" type="submit" disabled={busy}>{busy ? "Saving..." : editing ? "Save changes" : "Create note"}</button></footer></form></div>}
    {deleteTarget && <div className="notes-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setDeleteTarget(null); }}><div className="notes-dialog notes-confirm" role="alertdialog" aria-modal="true" aria-label="Delete note"><header><h2>Delete note?</h2><button type="button" aria-label="Close" disabled={busy} onClick={() => setDeleteTarget(null)}><X size={19} /></button></header><p>Delete “{deleteTarget.title}”?</p>{dialogError && <p className="notes-error" role="alert">{dialogError}</p>}<footer><button type="button" disabled={busy} onClick={() => setDeleteTarget(null)}>Cancel</button><button className="notes-danger" type="button" disabled={busy} onClick={() => void remove()}>{busy ? "Deleting..." : "Delete"}</button></footer></div></div>}
  </section>;
}
