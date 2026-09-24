import { AlarmClock, ArrowLeft, CalendarDays, Clock3, LoaderCircle, Pencil, Plus, Trash2, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import "./RemindersView.css";

type Reminder = {
  id: string;
  title: string;
  description: string | null;
  reminderDate: string;
  reminderTime: string | null;
  createdAt: string;
  updatedAt: string;
};
type ReminderDraft = {
  title: string;
  description: string;
  reminderDate: string;
  reminderTime: string;
  allDay: boolean;
};
type ReminderFilters = { from: string; to: string; name: string; description: string };
const emptyFilters = (): ReminderFilters => ({ from: "", to: "", name: "", description: "" });

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(year, month - 1, day));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatTime(value: string | null) {
  if (!value) return "All day";
  const [hour, minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
    .format(new Date(2000, 0, 1, hour, minute));
}

async function readError(response: Response) {
  const body = await response.json().catch(() => null) as { message?: string } | null;
  return body?.message || `Request failed (${response.status}).`;
}

export function RemindersView({ apiUrl, currentUsername, onBack, hidden }: {
  apiUrl: string;
  currentUsername: string;
  onBack: () => void;
  hidden: boolean;
}) {
  const endpoint = `${apiUrl}/api/user-reminders?username=${encodeURIComponent(currentUsername)}`;
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [filters, setFilters] = useState<ReminderFilters>(emptyFilters);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [viewing, setViewing] = useState<Reminder | null>(null);
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [draft, setDraft] = useState<ReminderDraft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Reminder | null>(null);
  const hasFilters = Object.values(filters).some((value) => value.trim() !== "");
  const filterDateError = filters.from && filters.to && filters.from > filters.to
    ? "The end date must be on or after the start date." : "";

  useEffect(() => {
    if (hidden) return;
    setError("");
    if (filterDateError) { setReminders([]); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams();
    for (const key of ["from", "to", "name", "description"] as const) {
      const value = filters[key].trim();
      if (value) params.set(key, value);
    }
    const timer = window.setTimeout(() => {
      fetch(`${endpoint}&${params}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(await readError(response));
          return response.json() as Promise<Reminder[]>;
        })
        .then((items) => { if (!controller.signal.aborted) setReminders(items); })
        .catch((reason) => { if (!controller.signal.aborted) { setReminders([]); setError(reason instanceof Error ? reason.message : "Could not load reminders."); } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [endpoint, hidden, filters, filterDateError, refreshVersion]);

  function openCreate() {
    setViewing(null);
    setEditing(null);
    setDialogError("");
    setDraft({ title: "", description: "", reminderDate: todayKey(), reminderTime: "09:00", allDay: false });
  }

  function openEdit(reminder: Reminder) {
    setViewing(null);
    setEditing(reminder);
    setDialogError("");
    setDraft({
      title: reminder.title,
      description: reminder.description ?? "",
      reminderDate: reminder.reminderDate,
      reminderTime: reminder.reminderTime?.slice(0, 5) ?? "09:00",
      allDay: reminder.reminderTime === null,
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving) return;
    setSaving(true);
    setDialogError("");
    try {
      const response = await fetch(editing ? `${apiUrl}/api/user-reminders/${editing.id}?username=${encodeURIComponent(currentUsername)}` : endpoint, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title.trim(),
          description: draft.description.trim() || null,
          reminderDate: draft.reminderDate,
          reminderTime: draft.allDay ? null : `${draft.reminderTime}:00`,
        }),
      });
      if (!response.ok) throw new Error(await readError(response));
      setRefreshVersion((value) => value + 1);
      setDraft(null);
      setEditing(null);
    } catch (reason) { setDialogError(reason instanceof Error ? reason.message : "Could not save reminder."); }
    finally { setSaving(false); }
  }

  async function remove() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDialogError("");
    try {
      const response = await fetch(`${apiUrl}/api/user-reminders/${deleteTarget.id}?username=${encodeURIComponent(currentUsername)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readError(response));
      setRefreshVersion((value) => value + 1);
      setDeleteTarget(null);
    } catch (reason) { setDialogError(reason instanceof Error ? reason.message : "Could not delete reminder."); }
    finally { setDeleting(false); }
  }

  return <section className="reminders-view" hidden={hidden} aria-label="Reminders">
    <header className="reminders-header">
      <div><p className="eyebrow">YOUR WORK</p><h1>Reminders</h1><p>Keep track of things you need to remember.</p></div>
      <div className="reminders-header-actions"><button type="button" onClick={onBack}><ArrowLeft size={16} /> Back to chat</button><button className="reminders-primary" type="button" onClick={openCreate}><Plus size={17} /> New reminder</button></div>
    </header>
    <div className="reminders-filters" role="search" aria-label="Filter reminders">
      <div className="reminders-filter-heading"><strong>Filters</strong>{hasFilters && <button type="button" onClick={() => setFilters(emptyFilters())}><X size={14} /> Clear filters</button>}</div>
      <div className="reminders-filter-fields">
        <label>From date<input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
        <label>To date<input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
        <label>Reminder name<input type="search" maxLength={200} placeholder="Search name" value={filters.name} onChange={(event) => setFilters({ ...filters, name: event.target.value })} /></label>
        <label>Description<input type="search" maxLength={200} placeholder="Search description" value={filters.description} onChange={(event) => setFilters({ ...filters, description: event.target.value })} /></label>
      </div>
      {filterDateError && <p className="reminders-error" role="alert">{filterDateError}</p>}
    </div>
    {error && <p className="reminders-error" role="alert">{error}</p>}
    <div className="reminders-list">
      {loading ? <div className="reminders-empty"><LoaderCircle className="reminders-spin" size={25} /> Loading reminders...</div> : reminders.length === 0 ? <div className="reminders-empty"><AlarmClock size={35} /><strong>{hasFilters ? "No reminders match your filters" : "No reminders yet"}</strong><span>{hasFilters ? "Try changing or clearing the filters." : "Create a reminder to see it here and on your calendar."}</span></div> :
        reminders.map((reminder) => <article className="reminders-item" key={reminder.id}>
          <button className="reminders-item-main" type="button" onClick={() => setViewing(reminder)}><span className="reminders-icon"><AlarmClock size={19} /></span><span><strong>{reminder.title}</strong><small><CalendarDays size={13} /> {formatDate(reminder.reminderDate)} <Clock3 size={13} /> {formatTime(reminder.reminderTime)}</small>{reminder.description && <em>{reminder.description}</em>}</span></button>
          <div className="reminders-item-actions"><button type="button" onClick={() => setViewing(reminder)}>View</button><button type="button" onClick={() => openEdit(reminder)}><Pencil size={15} /> Edit</button><button type="button" onClick={() => { setDialogError(""); setDeleteTarget(reminder); }}><Trash2 size={15} /> Delete</button></div>
        </article>)}
    </div>
    {viewing && <div className="reminders-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewing(null); }}><div className="reminders-dialog" role="dialog" aria-modal="true" aria-labelledby="reminders-detail-title"><header><div><p className="eyebrow">REMINDER DETAILS</p><h2 id="reminders-detail-title">{viewing.title}</h2></div><button type="button" aria-label="Close reminder" onClick={() => setViewing(null)}><X size={19} /></button></header><p className="reminders-detail-date"><CalendarDays size={16} /> {formatDate(viewing.reminderDate)} <Clock3 size={16} /> {formatTime(viewing.reminderTime)}</p>{viewing.description && <p className="reminders-description">{viewing.description}</p>}<p className="reminders-timestamps">Created {formatDateTime(viewing.createdAt)}<br />Updated {formatDateTime(viewing.updatedAt)}</p><footer><button type="button" onClick={() => { setViewing(null); setDialogError(""); setDeleteTarget(viewing); }}><Trash2 size={15} /> Delete</button><button type="button" onClick={() => openEdit(viewing)}><Pencil size={15} /> Edit</button><button type="button" onClick={() => setViewing(null)}>Close</button></footer></div></div>}
    {draft && <div className="reminders-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setDraft(null); }}><form className="reminders-dialog" aria-label={editing ? "Edit reminder" : "New reminder"} onSubmit={(event) => void save(event)}><header><h2>{editing ? "Edit reminder" : "New reminder"}</h2><button type="button" aria-label="Close" disabled={saving} onClick={() => setDraft(null)}><X size={19} /></button></header><label>Title<input autoFocus required maxLength={200} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="What do you need to remember?" /></label><div className="reminders-form-row"><label>Date<input type="date" required value={draft.reminderDate} onChange={(event) => setDraft({ ...draft, reminderDate: event.target.value })} /></label><label>Time<input type="time" required={!draft.allDay} disabled={draft.allDay} value={draft.reminderTime} onChange={(event) => setDraft({ ...draft, reminderTime: event.target.value })} /></label></div><label className="reminders-check"><input type="checkbox" checked={draft.allDay} onChange={(event) => setDraft({ ...draft, allDay: event.target.checked })} /> All day</label><label>Description<textarea maxLength={4000} rows={4} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Add details (optional)" /></label>{dialogError && <p className="reminders-error" role="alert">{dialogError}</p>}<footer><button type="button" disabled={saving} onClick={() => setDraft(null)}>Cancel</button><button className="reminders-primary" type="submit" disabled={saving}>{saving ? "Saving..." : editing ? "Save changes" : "Create reminder"}</button></footer></form></div>}
    {deleteTarget && <div className="reminders-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleting) setDeleteTarget(null); }}><div className="reminders-dialog reminders-confirm" role="alertdialog" aria-modal="true" aria-label="Delete reminder"><header><h2>Delete reminder?</h2><button type="button" aria-label="Close" disabled={deleting} onClick={() => setDeleteTarget(null)}><X size={19} /></button></header><p>Delete “{deleteTarget.title}”?</p>{dialogError && <p className="reminders-error" role="alert">{dialogError}</p>}<footer><button type="button" disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancel</button><button className="reminders-danger" type="button" disabled={deleting} onClick={() => void remove()}>{deleting ? "Deleting..." : "Delete"}</button></footer></div></div>}
  </section>;
}
