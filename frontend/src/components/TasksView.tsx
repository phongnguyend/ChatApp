import { ArrowLeft, CalendarDays, Check, CircleCheck, ClipboardList, List, ListTodo, LoaderCircle, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import "./TasksView.css";

type UserTask = {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  priority: "low" | "normal" | "high";
  isCompleted: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
type TaskDraft = Pick<UserTask, "title" | "priority"> & { description: string; dueDate: string };
const emptyDraft: TaskDraft = { title: "", description: "", dueDate: "", priority: "normal" };

async function readError(response: Response) {
  const body = await response.json().catch(() => null) as { message?: string } | null;
  return body?.message || `Request failed (${response.status}).`;
}

function dueLabel(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" })
    .format(new Date(year, month - 1, day));
}

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
function formatDateTime(value: string) {
  return dateTimeFormatter.format(new Date(value));
}

export function TasksView({ apiUrl, currentUsername, onBack, hidden }: {
  apiUrl: string;
  currentUsername: string;
  onBack: () => void;
  hidden: boolean;
}) {
  const endpoint = `${apiUrl}/api/user-tasks?username=${encodeURIComponent(currentUsername)}`;
  const [tasks, setTasks] = useState<UserTask[]>([]);
  const [filter, setFilter] = useState<"all" | "active" | "completed">("active");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [editing, setEditing] = useState<UserTask | null>(null);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deleteTarget, setDeleteTarget] = useState<UserTask[] | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [completionTarget, setCompletionTarget] = useState<{ tasks: UserTask[]; isCompleted: boolean } | null>(null);
  const [completionError, setCompletionError] = useState("");

  useEffect(() => {
    if (hidden) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(endpoint, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return response.json() as Promise<UserTask[]>;
      })
      .then((items) => { if (!controller.signal.aborted) { setTasks(items); setSelectedIds(new Set()); } })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load tasks."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, hidden]);

  function openCreate() { setEditing(null); setDraft({ ...emptyDraft }); setDialogError(""); }
  function openEdit(task: UserTask) {
    setEditing(task);
    setDraft({ title: task.title, description: task.description ?? "", dueDate: task.dueDate ?? "", priority: task.priority });
    setDialogError("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving) return;
    if (!draft.title.trim()) { setDialogError("Enter a task title."); return; }
    setSaving(true);
    setDialogError("");
    try {
      const response = await fetch(editing ? `${apiUrl}/api/user-tasks/${editing.id}?username=${encodeURIComponent(currentUsername)}` : endpoint, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: draft.title.trim(), description: draft.description.trim() || null, dueDate: draft.dueDate || null, priority: draft.priority }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const item = await response.json() as UserTask;
      setTasks((current) => editing ? current.map((task) => task.id === item.id ? item : task) : [item, ...current]);
      setDraft(null);
    } catch (reason) {
      setDialogError(reason instanceof Error ? reason.message : "Could not save task.");
    } finally { setSaving(false); }
  }

  function requestCompletion(items: UserTask[], isCompleted: boolean) {
    const changed = items.filter((task) => task.isCompleted !== isCompleted);
    if (!changed.length) return;
    setCompletionTarget({ tasks: changed, isCompleted });
    setCompletionError("");
  }

  async function setCompletion() {
    if (!completionTarget || busyId) return;
    setBusyId("status");
    setError("");
    setCompletionError("");
    const results = await Promise.allSettled(completionTarget.tasks.map(async (task) => {
      const response = await fetch(`${apiUrl}/api/user-tasks/${task.id}/completion?username=${encodeURIComponent(currentUsername)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isCompleted: completionTarget.isCompleted }),
      });
      if (!response.ok) throw new Error(await readError(response));
      return response.json() as Promise<UserTask>;
    }));
    const updated = new Map<string, UserTask>();
    const failed: UserTask[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") updated.set(result.value.id, result.value);
      else failed.push(completionTarget.tasks[index]);
    });
    setTasks((current) => current.map((task) => updated.get(task.id) ?? task));
    setSelectedIds((current) => new Set([...current].filter((id) => !updated.has(id))));
    if (failed.length) {
      setCompletionTarget({ ...completionTarget, tasks: failed });
      setCompletionError(`Could not update ${failed.length} task${failed.length === 1 ? "" : "s"}. Please try again.`);
    } else setCompletionTarget(null);
    setBusyId(null);
  }

  async function remove() {
    if (!deleteTarget || busyId) return;
    setBusyId("delete");
    setError("");
    setDeleteError("");
    const results = await Promise.allSettled(deleteTarget.map(async (task) => {
      const response = await fetch(`${apiUrl}/api/user-tasks/${task.id}?username=${encodeURIComponent(currentUsername)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readError(response));
      return task.id;
    }));
    const removed = new Set<string>();
    const failed: UserTask[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") removed.add(result.value);
      else failed.push(deleteTarget[index]);
    });
    setTasks((current) => current.filter((task) => !removed.has(task.id)));
    setSelectedIds((current) => new Set([...current].filter((id) => !removed.has(id))));
    if (failed.length) {
      setDeleteTarget(failed);
      setDeleteError(`Could not delete ${failed.length} task${failed.length === 1 ? "" : "s"}. Please try again.`);
    } else setDeleteTarget(null);
    setBusyId(null);
  }

  const visible = tasks.filter((task) => filter === "all" || task.isCompleted === (filter === "completed"))
    .sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted) ||
      (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || b.createdAt.localeCompare(a.createdAt));
  const selectedTasks = tasks.filter((task) => selectedIds.has(task.id));
  const allVisibleSelected = visible.length > 0 && visible.every((task) => selectedIds.has(task.id));
  const activeCount = tasks.filter((task) => !task.isCompleted).length;
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return <section className="tasks-view" hidden={hidden} aria-label="Tasks">
    <header className="tasks-header">
      <div><p className="eyebrow">YOUR WORK</p><h1>Tasks</h1><p>Keep track of what needs to get done.</p></div>
      <div className="tasks-header-actions"><button className="tasks-back" type="button" onClick={onBack}><ArrowLeft size={16} /> Back to chat</button><button className="tasks-primary" type="button" onClick={openCreate}><Plus size={17} /> New task</button></div>
    </header>
    <div className="tasks-toolbar" role="tablist" aria-label="Task status">
      {(["active", "all", "completed"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "active" : ""} onClick={() => { setFilter(value); setSelectedIds(new Set()); }}>{value === "active" ? <ListTodo size={15} aria-hidden="true" /> : value === "all" ? <List size={15} aria-hidden="true" /> : <CircleCheck size={15} aria-hidden="true" />}{value === "active" ? `To do (${activeCount})` : value === "all" ? `All (${tasks.length})` : `Completed (${tasks.length - activeCount})`}</button>)}
    </div>
    {!loading && visible.length > 0 && <div className="tasks-selection-bar">
      <label><input type="checkbox" checked={allVisibleSelected} onChange={() => setSelectedIds((current) => { const next = new Set(current); visible.forEach((task) => { if (allVisibleSelected) next.delete(task.id); else next.add(task.id); }); return next; })} disabled={!!busyId} /> Select all</label>
      {selectedTasks.length > 0 && <div className="tasks-bulk-actions"><span>{selectedTasks.length} selected</span><button type="button" onClick={() => requestCompletion(selectedTasks, true)} disabled={!!busyId || selectedTasks.every((task) => task.isCompleted)}><Check size={15} /> Done</button><button type="button" onClick={() => requestCompletion(selectedTasks, false)} disabled={!!busyId || selectedTasks.every((task) => !task.isCompleted)}><RotateCcw size={15} /> Undone</button><button type="button" onClick={() => { setDeleteTarget(selectedTasks); setDeleteError(""); }} disabled={!!busyId}><Trash2 size={15} /> Delete</button></div>}
    </div>}
    {error && <p className="tasks-error" role="alert">{error}</p>}
    <div className="tasks-list">
      {loading ? <div className="tasks-empty"><LoaderCircle className="tasks-spin" size={25} /> Loading tasks...</div> : visible.length === 0 ? <div className="tasks-empty"><ClipboardList size={35} /><strong>{filter === "active" ? "Nothing to do" : "No tasks here"}</strong><span>{filter === "active" ? "Add a task to get started." : "Tasks in this view will appear here."}</span></div> :
        visible.map((task) => <article className={`tasks-item ${task.isCompleted ? "completed" : ""}`} key={task.id}>
          <input className="tasks-select" type="checkbox" aria-label={`Select ${task.title}`} checked={selectedIds.has(task.id)} disabled={!!busyId} onChange={() => setSelectedIds((current) => { const next = new Set(current); if (next.has(task.id)) next.delete(task.id); else next.add(task.id); return next; })} />
          <div className="tasks-item-content"><h2>{task.title}</h2>{task.description && <p>{task.description}</p>}<div className="tasks-meta">{task.dueDate && <span className={task.dueDate < todayKey && !task.isCompleted ? "overdue" : ""}><CalendarDays size={14} /> {dueLabel(task.dueDate)}</span>}<span className={`tasks-priority ${task.priority}`}>{task.priority} priority</span></div><div className="tasks-timestamps"><span>Created <time dateTime={task.createdAt}>{formatDateTime(task.createdAt)}</time></span><span>Updated <time dateTime={task.updatedAt}>{formatDateTime(task.updatedAt)}</time></span></div></div>
          <div className="tasks-item-actions"><button type="button" aria-label={`Done: ${task.title}`} disabled={!!busyId || task.isCompleted} onClick={() => requestCompletion([task], true)}><Check size={16} /> Done</button><button type="button" aria-label={`Undone: ${task.title}`} disabled={!!busyId || !task.isCompleted} onClick={() => requestCompletion([task], false)}><RotateCcw size={16} /> Undone</button><button type="button" aria-label={`Edit ${task.title}`} disabled={!!busyId} onClick={() => openEdit(task)}><Pencil size={16} /> Edit</button><button type="button" aria-label={`Delete ${task.title}`} disabled={!!busyId} onClick={() => { setDeleteTarget([task]); setDeleteError(""); }}><Trash2 size={16} /> Delete</button></div>
        </article>)}
    </div>
    {draft && <div className="tasks-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setDraft(null); }}><form className="tasks-dialog" onSubmit={(event) => void save(event)} aria-label={editing ? "Edit task" : "New task"}>
      <header><h2>{editing ? "Edit task" : "New task"}</h2><button type="button" aria-label="Close" onClick={() => setDraft(null)} disabled={saving}><X size={19} /></button></header>
      <label>Title<input autoFocus maxLength={200} required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="What needs to be done?" /></label>
      <div className="tasks-form-row"><label>Due date<input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label><label>Priority<select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as TaskDraft["priority"] })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label></div>
      <label>Notes<textarea maxLength={4000} rows={4} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Add details (optional)" /></label>
      {dialogError && <p className="tasks-error" role="alert">{dialogError}</p>}
      <footer><button type="button" onClick={() => setDraft(null)} disabled={saving}>Cancel</button><button className="tasks-primary" type="submit" disabled={saving}>{saving ? "Saving..." : editing ? "Save changes" : "Add task"}</button></footer>
    </form></div>}
    {completionTarget && <div className="tasks-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyId) setCompletionTarget(null); }}><div className="tasks-dialog tasks-confirm" role="alertdialog" aria-modal="true" aria-label="Confirm task status"><header><h2>Mark {completionTarget.tasks.length === 1 ? "task" : `${completionTarget.tasks.length} tasks`} as {completionTarget.isCompleted ? "done" : "undone"}?</h2><button type="button" aria-label="Close" onClick={() => setCompletionTarget(null)} disabled={!!busyId}><X size={19} /></button></header>{completionTarget.tasks.length === 1 && <p>{completionTarget.tasks[0].title}</p>}{completionError && <p className="tasks-error" role="alert">{completionError}</p>}<footer><button type="button" onClick={() => setCompletionTarget(null)} disabled={!!busyId}>Cancel</button><button className="tasks-primary" type="button" onClick={() => void setCompletion()} disabled={!!busyId}>{busyId ? "Saving..." : completionTarget.isCompleted ? "Done" : "Undone"}</button></footer></div></div>}
    {deleteTarget && <div className="tasks-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyId) setDeleteTarget(null); }}><div className="tasks-dialog tasks-confirm" role="alertdialog" aria-modal="true" aria-label="Delete task"><header><h2>Delete {deleteTarget.length === 1 ? "task" : `${deleteTarget.length} tasks`}?</h2><button type="button" aria-label="Close" onClick={() => setDeleteTarget(null)} disabled={!!busyId}><X size={19} /></button></header>{deleteTarget.length === 1 && <p>Delete “{deleteTarget[0].title}”?</p>}{deleteError && <p className="tasks-error" role="alert">{deleteError}</p>}<footer><button type="button" onClick={() => setDeleteTarget(null)} disabled={!!busyId}>Cancel</button><button className="tasks-danger" type="button" onClick={() => void remove()} disabled={!!busyId}>{busyId ? "Deleting..." : "Delete"}</button></footer></div></div>}
  </section>;
}
