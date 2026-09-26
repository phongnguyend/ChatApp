import { authFetch as fetch } from "../services/auth";
import { ArrowLeft, CalendarDays, Check, CircleCheck, ClipboardList, List, ListTodo, LoaderCircle, Pencil, Plus, RotateCcw, Share2, Trash2, UserRound, Users, X } from "lucide-react";
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
  ownerUserId: string;
  ownerUsername: string;
  ownerDisplayName: string;
  permission: "owner" | "viewer" | "editor";
  shareCount: number;
  assigneeUserId: string | null;
  assigneeUsername: string | null;
  assigneeDisplayName: string | null;
};
type TaskShare = { id: string; userId: string; username: string; displayName: string; permission: "viewer" | "editor" };
type AssigneeCandidate = { userId: string; username: string; displayName: string };
type Person = { id: string; username: string; displayName: string };
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

export function TasksView({ apiUrl, currentUsername, onBack, openTarget, hidden }: {
  apiUrl: string;
  currentUsername: string;
  onBack: () => void;
  openTarget?: { id: string; request: number } | null;
  hidden: boolean;
}) {
  const endpoint = `${apiUrl}/api/user-tasks?username=${encodeURIComponent(currentUsername)}`;
  const [tasks, setTasks] = useState<UserTask[]>([]);
  const [filter, setFilter] = useState<"all" | "active" | "completed">("active");
  const [mode, setMode] = useState<"mine" | "shared" | "outgoing">("mine");
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
  const [sharing, setSharing] = useState<UserTask | null>(null);
  const [shares, setShares] = useState<TaskShare[]>([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareSaving, setShareSaving] = useState(false);
  const [shareError, setShareError] = useState("");
  const [peopleQuery, setPeopleQuery] = useState("");
  const [peopleResults, setPeopleResults] = useState<Person[]>([]);
  const [recipient, setRecipient] = useState<Person | null>(null);
  const [newPermission, setNewPermission] = useState<"viewer" | "editor">("viewer");
  const [assigning, setAssigning] = useState<UserTask | null>(null);
  const [assignees, setAssignees] = useState<AssigneeCandidate[]>([]);
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignError, setAssignError] = useState("");
  const [assigneeId, setAssigneeId] = useState("");

  useEffect(() => {
    if (hidden || !openTarget || tasks.length === 0) return;
    const task = tasks.find((item) => item.id === openTarget.id);
    if (!task) return;
    setMode(task.permission === "owner" ? "mine" : "shared");
    setFilter("all");
    window.requestAnimationFrame(() => document.querySelector(`[data-task-id="${task.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [hidden, openTarget, tasks]);

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
  }, [endpoint, hidden, mode]);

  const sharingId = sharing?.id;
  useEffect(() => {
    if (!sharingId || hidden) return;
    const controller = new AbortController();
    setShareLoading(true);
    setShareError("");
    fetch(`${apiUrl}/api/user-tasks/${sharingId}/shares?username=${encodeURIComponent(currentUsername)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return response.json() as Promise<TaskShare[]>;
      })
      .then((items) => { if (!controller.signal.aborted) setShares(items); })
      .catch((reason) => { if (!controller.signal.aborted) setShareError(reason instanceof Error ? reason.message : "Could not load sharing."); })
      .finally(() => { if (!controller.signal.aborted) setShareLoading(false); });
    return () => controller.abort();
  }, [apiUrl, currentUsername, hidden, sharingId]);

  const assigningId = assigning?.id;
  useEffect(() => {
    if (!assigningId || hidden) return;
    const controller = new AbortController();
    setAssignLoading(true);
    setAssignError("");
    fetch(`${apiUrl}/api/user-tasks/${assigningId}/assignees?username=${encodeURIComponent(currentUsername)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return response.json() as Promise<AssigneeCandidate[]>;
      })
      .then((items) => { if (!controller.signal.aborted) setAssignees(items); })
      .catch((reason) => { if (!controller.signal.aborted) setAssignError(reason instanceof Error ? reason.message : "Could not load assignees."); })
      .finally(() => { if (!controller.signal.aborted) setAssignLoading(false); });
    return () => controller.abort();
  }, [apiUrl, currentUsername, hidden, assigningId]);

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

  function openShare(task: UserTask) {
    if (task.permission !== "owner") return;
    setSharing(task);
    setShares([]);
    setShareError("");
    setPeopleQuery("");
    setPeopleResults([]);
    setRecipient(null);
    setNewPermission("viewer");
  }

  function openAssign(task: UserTask) {
    if (task.permission !== "owner") return;
    setAssigning(task);
    setAssignees([]);
    setAssignError("");
    setAssigneeId(task.assigneeUserId ?? "");
  }

  async function putShare(recipientUsername: string, permission: "viewer" | "editor") {
    if (!sharing || shareSaving) return;
    setShareSaving(true);
    setShareError("");
    try {
      const response = await fetch(`${apiUrl}/api/user-tasks/${sharing.id}/shares?username=${encodeURIComponent(currentUsername)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientUsername, permission }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const updated = await response.json() as TaskShare;
      const existed = shares.some((item) => item.id === updated.id);
      setShares((current) => [...current.filter((item) => item.id !== updated.id), updated]
        .sort((a, b) => a.displayName.localeCompare(b.displayName)));
      if (!existed) setTasks((current) => current.map((task) => task.id === sharing.id ? { ...task, shareCount: task.shareCount + 1 } : task));
      setRecipient(null);
      setPeopleQuery("");
    } catch (reason) { setShareError(reason instanceof Error ? reason.message : "Could not update sharing."); }
    finally { setShareSaving(false); }
  }

  async function removeShare(share: TaskShare) {
    if (!sharing || shareSaving) return;
    setShareSaving(true);
    setShareError("");
    try {
      const response = await fetch(`${apiUrl}/api/user-tasks/${sharing.id}/shares/${share.id}?username=${encodeURIComponent(currentUsername)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readError(response));
      setShares((current) => current.filter((item) => item.id !== share.id));
      setTasks((current) => current.map((task) => task.id === sharing.id ? {
        ...task, shareCount: Math.max(0, task.shareCount - 1),
        ...(task.assigneeUserId === share.userId ? { assigneeUserId: null, assigneeUsername: null, assigneeDisplayName: null } : {}),
      } : task));
    } catch (reason) { setShareError(reason instanceof Error ? reason.message : "Could not remove access."); }
    finally { setShareSaving(false); }
  }

  async function saveAssignee() {
    if (!assigning || assignSaving || assignLoading) return;
    setAssignSaving(true);
    setAssignError("");
    try {
      const response = await fetch(`${apiUrl}/api/user-tasks/${assigning.id}/assignee?username=${encodeURIComponent(currentUsername)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeUserId: assigneeId || null }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const updated = await response.json() as UserTask;
      setTasks((current) => current.map((task) => task.id === updated.id ? updated : task));
      setAssigning(null);
    } catch (reason) { setAssignError(reason instanceof Error ? reason.message : "Could not assign task."); }
    finally { setAssignSaving(false); }
  }

  function openCreate() { setMode("mine"); setEditing(null); setDraft({ ...emptyDraft }); setDialogError(""); }
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

  const scoped = tasks.filter((task) => mode === "mine" ? task.permission === "owner" :
    mode === "shared" ? task.permission !== "owner" : task.permission === "owner" && task.shareCount > 0);
  const visible = scoped.filter((task) => filter === "all" || task.isCompleted === (filter === "completed"))
    .sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted) ||
      (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || b.createdAt.localeCompare(a.createdAt));
  const canComplete = (task: UserTask) => task.permission !== "viewer" ||
    task.assigneeUsername?.toLowerCase() === currentUsername.toLowerCase();
  const selectable = visible.filter(canComplete);
  const selectedTasks = tasks.filter((task) => selectedIds.has(task.id) && canComplete(task));
  const allVisibleSelected = selectable.length > 0 && selectable.every((task) => selectedIds.has(task.id));
  const activeCount = scoped.filter((task) => !task.isCompleted).length;
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return <section className="tasks-view" hidden={hidden} aria-label="Tasks">
    <header className="tasks-header">
      <div><p className="eyebrow">YOUR WORK</p><h1>Tasks</h1><p>Keep track of what needs to get done.</p></div>
      <div className="tasks-header-actions"><button className="tasks-back" type="button" onClick={onBack}><ArrowLeft size={16} /> Back to chat</button><button className="tasks-primary" type="button" onClick={openCreate}><Plus size={17} /> New task</button></div>
    </header>
    <div className="tasks-toolbar" role="tablist" aria-label="Task sections">
      <button type="button" role="tab" aria-selected={mode === "mine"} className={mode === "mine" ? "active" : ""} onClick={() => { setMode("mine"); setSelectedIds(new Set()); }}><ClipboardList size={15} /> My tasks</button>
      <button type="button" role="tab" aria-selected={mode === "shared"} className={mode === "shared" ? "active" : ""} onClick={() => { setMode("shared"); setSelectedIds(new Set()); }}><Users size={15} /> Shared with me</button>
      <button type="button" role="tab" aria-selected={mode === "outgoing"} className={mode === "outgoing" ? "active" : ""} onClick={() => { setMode("outgoing"); setSelectedIds(new Set()); }}><Share2 size={15} /> Shared by me</button>
    </div>
    <div className="tasks-toolbar tasks-status-toolbar" role="tablist" aria-label="Task status">
      {(["active", "all", "completed"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "active" : ""} onClick={() => { setFilter(value); setSelectedIds(new Set()); }}>{value === "active" ? <ListTodo size={15} aria-hidden="true" /> : value === "all" ? <List size={15} aria-hidden="true" /> : <CircleCheck size={15} aria-hidden="true" />}{value === "active" ? `To do (${activeCount})` : value === "all" ? `All (${scoped.length})` : `Completed (${scoped.length - activeCount})`}</button>)}
    </div>
    {!loading && visible.length > 0 && <div className="tasks-selection-bar">
      <label><input type="checkbox" checked={allVisibleSelected} onChange={() => setSelectedIds((current) => { const next = new Set(current); selectable.forEach((task) => { if (allVisibleSelected) next.delete(task.id); else next.add(task.id); }); return next; })} disabled={!!busyId || selectable.length === 0} /> Select all</label>
      {selectedTasks.length > 0 && <div className="tasks-bulk-actions"><span>{selectedTasks.length} selected</span><button type="button" onClick={() => requestCompletion(selectedTasks, true)} disabled={!!busyId || selectedTasks.every((task) => task.isCompleted)}><Check size={15} /> Done</button><button type="button" onClick={() => requestCompletion(selectedTasks, false)} disabled={!!busyId || selectedTasks.every((task) => !task.isCompleted)}><RotateCcw size={15} /> Undone</button>{selectedTasks.every((task) => task.permission === "owner") && <button type="button" onClick={() => { setDeleteTarget(selectedTasks); setDeleteError(""); }} disabled={!!busyId}><Trash2 size={15} /> Delete</button>}</div>}
    </div>}
    {error && <p className="tasks-error" role="alert">{error}</p>}
    <div className="tasks-list">
      {loading ? <div className="tasks-empty"><LoaderCircle className="tasks-spin" size={25} /> Loading tasks...</div> : visible.length === 0 ? <div className="tasks-empty"><ClipboardList size={35} /><strong>{mode === "shared" ? "Nothing shared with you" : mode === "outgoing" ? "No shared tasks yet" : filter === "active" ? "Nothing to do" : "No tasks here"}</strong><span>{mode === "shared" ? "Tasks others share with you appear here." : mode === "outgoing" ? "Share a task to see it here." : filter === "active" ? "Add a task to get started." : "Tasks in this view will appear here."}</span></div> :
        visible.map((task) => <article data-task-id={task.id} className={`tasks-item ${task.isCompleted ? "completed" : ""} ${openTarget?.id === task.id ? "notification-target" : ""}`} key={task.id}>
          <input className="tasks-select" type="checkbox" aria-label={`Select ${task.title}`} checked={selectedIds.has(task.id)} disabled={!!busyId || !canComplete(task)} onChange={() => setSelectedIds((current) => { const next = new Set(current); if (next.has(task.id)) next.delete(task.id); else next.add(task.id); return next; })} />
          <div className="tasks-item-content">
            <h2>{task.title}</h2>
            {task.description && <p>{task.description}</p>}
            <div className="tasks-meta">{task.dueDate && <span className={task.dueDate < todayKey && !task.isCompleted ? "overdue" : ""}><CalendarDays size={14} /> {dueLabel(task.dueDate)}</span>}<span className={`tasks-priority ${task.priority}`}>{task.priority} priority</span></div>
            {task.permission !== "owner" && <div className="tasks-access">Shared by {task.ownerDisplayName} · {task.permission === "editor" ? "Can edit" : "Can view"}</div>}
            {task.permission === "owner" && task.shareCount > 0 && <div className="tasks-access">Shared with {task.shareCount} {task.shareCount === 1 ? "person" : "people"}</div>}
            {task.assigneeDisplayName && <div className="tasks-access"><UserRound size={13} aria-hidden="true" /> Assigned to {task.assigneeDisplayName}</div>}
            <div className="tasks-timestamps"><span>Created <time dateTime={task.createdAt}>{formatDateTime(task.createdAt)}</time></span><span>Updated <time dateTime={task.updatedAt}>{formatDateTime(task.updatedAt)}</time></span></div>
          </div>
          <div className="tasks-item-actions">{canComplete(task) && <><button type="button" aria-label={`Done: ${task.title}`} disabled={!!busyId || task.isCompleted} onClick={() => requestCompletion([task], true)}><Check size={16} /> Done</button><button type="button" aria-label={`Undone: ${task.title}`} disabled={!!busyId || !task.isCompleted} onClick={() => requestCompletion([task], false)}><RotateCcw size={16} /> Undone</button></>}{task.permission !== "viewer" && <button type="button" aria-label={`Edit ${task.title}`} disabled={!!busyId} onClick={() => openEdit(task)}><Pencil size={16} /> Edit</button>}{task.permission === "owner" && <><button type="button" aria-label={`Share ${task.title}`} disabled={!!busyId} onClick={() => openShare(task)}><Share2 size={16} /> Share</button><button type="button" aria-label={`Assign ${task.title}`} disabled={!!busyId} onClick={() => openAssign(task)}><UserRound size={16} /> Assign</button><button type="button" aria-label={`Delete ${task.title}`} disabled={!!busyId} onClick={() => { setDeleteTarget([task]); setDeleteError(""); }}><Trash2 size={16} /> Delete</button></>}</div>
        </article>)}
    </div>
    {sharing && <div className="tasks-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !shareSaving) setSharing(null); }}>
      <div className="tasks-dialog tasks-share" role="dialog" aria-modal="true" aria-labelledby="tasks-share-title">
        <header><h2 id="tasks-share-title">Share “{sharing.title}”</h2><button type="button" aria-label="Close sharing" disabled={shareSaving} onClick={() => setSharing(null)}><X size={19} /></button></header>
        <label>Add a person<input value={peopleQuery} onChange={(event) => { setPeopleQuery(event.target.value); setRecipient(null); setShareError(""); }} placeholder="Search name or username" autoComplete="off" /></label>
        {!recipient && peopleQuery.trim() && peopleResults.length > 0 && <div className="tasks-people-results" role="listbox" aria-label="People">
          {peopleResults.map((person) => <button type="button" role="option" aria-selected={false} key={person.id} onClick={() => { setRecipient(person); setPeopleQuery(`${person.displayName} (@${person.username})`); setPeopleResults([]); }}>{person.displayName} <small>@{person.username}</small></button>)}
        </div>}
        <div className="tasks-share-add"><label>Permission<select value={newPermission} onChange={(event) => setNewPermission(event.target.value as "viewer" | "editor")}><option value="viewer">Viewer — can view</option><option value="editor">Editor — can view and edit</option></select></label><button className="tasks-primary" type="button" disabled={!recipient || shareLoading || shareSaving} onClick={() => { if (recipient) void putShare(recipient.username, newPermission); }}>{shareSaving ? "Saving..." : "Share"}</button></div>
        <div className="tasks-share-list"><strong>People with access</strong>
          {shareLoading ? <p>Loading access...</p> : shares.length === 0 ? <p>Only you have access.</p> : shares.map((share) => <div className="tasks-share-person" key={share.id}><span>{share.displayName}<small>@{share.username}</small></span><select aria-label={`Permission for ${share.displayName}`} value={share.permission} disabled={shareSaving} onChange={(event) => void putShare(share.username, event.target.value as "viewer" | "editor")}><option value="viewer">Viewer</option><option value="editor">Editor</option></select><button type="button" disabled={shareSaving} onClick={() => void removeShare(share)}>Remove</button></div>)}
        </div>
        {shareError && <p className="tasks-error" role="alert">{shareError}</p>}
        <footer><button type="button" disabled={shareSaving} onClick={() => setSharing(null)}>Close</button></footer>
      </div>
    </div>}
    {assigning && <div className="tasks-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !assignSaving) setAssigning(null); }}>
      <div className="tasks-dialog tasks-assignment-dialog" role="dialog" aria-modal="true" aria-labelledby="tasks-assignment-title">
        <header><h2 id="tasks-assignment-title">Assign “{assigning.title}”</h2><button type="button" aria-label="Close assignment" disabled={assignSaving} onClick={() => setAssigning(null)}><X size={19} /></button></header>
        <label>Assigned to<select value={assigneeId} disabled={assignLoading || assignSaving} onChange={(event) => setAssigneeId(event.target.value)}><option value="">Unassigned</option>{assignees.map((candidate) => <option key={candidate.userId} value={candidate.userId}>{candidate.userId === assigning.ownerUserId ? "Assign to me" : `${candidate.displayName} (@${candidate.username})`}</option>)}</select></label>
        {assignLoading && <p className="tasks-assignment-help">Loading people...</p>}
        {!assignLoading && assignees.length === 1 && <p className="tasks-assignment-help">Share this task to assign it to someone else.</p>}
        {assignError && <p className="tasks-error" role="alert">{assignError}</p>}
        <footer><button type="button" disabled={assignSaving} onClick={() => setAssigning(null)}>Cancel</button><button className="tasks-primary" type="button" disabled={assignLoading || assignSaving || assigneeId === (assigning.assigneeUserId ?? "")} onClick={() => void saveAssignee()}>{assignSaving ? "Saving..." : "Save assignment"}</button></footer>
      </div>
    </div>}
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
