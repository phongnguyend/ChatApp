import { ArrowLeft, Bell, CalendarDays, Check, CheckCheck, ClipboardList, FileText, FolderOpen, LoaderCircle, MessageCircle, NotebookPen, Radio, RefreshCw, UserRoundCheck } from "lucide-react";
import { useEffect, useState } from "react";
import "./NotificationsView.css";

export type NotificationType = "meeting_invite" | "meeting_rescheduled" | "meeting_cancelled" | "document_file_share" | "document_folder_share" | "note_share" | "task_share" | "task_assignment" | "message_reaction" | "recording_ready";
export type UserNotification = {
  id: string;
  type: NotificationType;
  targetId: string;
  contextId: string | null;
  targetTitle: string;
  details: string | null;
  actorDisplayName: string;
  actorUsername: string;
  createdAt: string;
  readAt: string | null;
};
type NotificationPage = { items: UserNotification[]; hasMore: boolean; unreadCount: number };

async function readError(response: Response) {
  const body = await response.json().catch(() => null) as { message?: string } | null;
  return body?.message || `Request failed (${response.status}).`;
}

function activity(type: NotificationType) {
  switch (type) {
    case "meeting_invite": return { action: "invited you to a meeting", icon: CalendarDays };
    case "meeting_rescheduled": return { action: "changed the meeting date or time", icon: CalendarDays };
    case "meeting_cancelled": return { action: "cancelled a meeting", icon: CalendarDays };
    case "document_file_share": return { action: "shared a file with you", icon: FileText };
    case "document_folder_share": return { action: "shared a folder with you", icon: FolderOpen };
    case "note_share": return { action: "shared a note with you", icon: NotebookPen };
    case "task_share": return { action: "shared a task with you", icon: ClipboardList };
    case "task_assignment": return { action: "assigned you a task", icon: UserRoundCheck };
    case "message_reaction": return { action: "reacted to your message", icon: MessageCircle };
    case "recording_ready": return { action: "made a recording available", icon: Radio };
  }
}

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function NotificationsView({ apiUrl, currentUsername, onBack, onOpen, onUnreadCountChange, hidden }: {
  apiUrl: string;
  currentUsername: string;
  onBack: () => void;
  onOpen: (notification: UserNotification) => Promise<void>;
  onUnreadCountChange: (count: number) => void;
  hidden: boolean;
}) {
  const endpoint = `${apiUrl}/api/user-notifications?username=${encodeURIComponent(currentUsername)}`;
  const [items, setItems] = useState<UserNotification[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (hidden) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`${endpoint}&page=${page}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return response.json() as Promise<NotificationPage>;
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        setItems((current) => page === 0 ? result.items : [...current, ...result.items]);
        setHasMore(result.hasMore);
        setUnreadCount(result.unreadCount);
        onUnreadCountChange(result.unreadCount);
      })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load notifications."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, hidden, page, refreshVersion, onUnreadCountChange]);

  function refresh() {
    setPage(0);
    setRefreshVersion((value) => value + 1);
  }

  async function markRead(item: UserNotification) {
    if (busyId) return;
    setBusyId(item.id);
    setError("");
    try {
      if (!item.readAt) {
        const response = await fetch(`${apiUrl}/api/user-notifications/${item.id}/read?username=${encodeURIComponent(currentUsername)}`, { method: "POST" });
        if (!response.ok) throw new Error(await readError(response));
        const readAt = new Date().toISOString();
        setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, readAt } : entry));
        const nextUnreadCount = Math.max(0, unreadCount - 1);
        setUnreadCount(nextUnreadCount);
        onUnreadCountChange(nextUnreadCount);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not mark notification as read."); }
    finally { setBusyId(null); }
  }

  async function open(item: UserNotification) {
    if (busyId) return;
    await markRead(item);
    setBusyId(item.id);
    setError("");
    try { await onOpen(item); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not open this notification."); }
    finally { setBusyId(null); }
  }

  async function markAllRead() {
    if (markingAll || unreadCount === 0) return;
    setMarkingAll(true);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/api/user-notifications/read-all?username=${encodeURIComponent(currentUsername)}`, { method: "POST" });
      if (!response.ok) throw new Error(await readError(response));
      const readAt = new Date().toISOString();
      setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? readAt })));
      setUnreadCount(0);
      onUnreadCountChange(0);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not mark notifications as read."); }
    finally { setMarkingAll(false); }
  }

  return <section className="notifications-view" hidden={hidden} aria-label="Notifications">
    <header className="notifications-header">
      <div><p className="eyebrow">YOUR ACTIVITY</p><h1>Notifications</h1><p>Reactions, recordings, meetings, shares, and assignments appear here.</p></div>
      <div className="notifications-header-actions"><button type="button" onClick={onBack}><ArrowLeft size={16} /> Back to chat</button><button type="button" onClick={refresh} disabled={loading}><RefreshCw size={15} /> Refresh</button></div>
    </header>
    <div className="notifications-toolbar"><span>{unreadCount} unread</span><button type="button" disabled={markingAll || unreadCount === 0} onClick={() => void markAllRead()}><CheckCheck size={15} /> Mark all as read</button></div>
    {error && <p className="notifications-error" role="alert">{error}</p>}
    <div className="notifications-list">
      {loading && page === 0 ? <div className="notifications-empty"><LoaderCircle className="notifications-spin" size={26} /> Loading notifications...</div> : items.length === 0 ? <div className="notifications-empty"><Bell size={35} /><strong>No notifications yet</strong><span>New reactions, recordings, invitations, shares, and assignments will appear here.</span></div> : items.map((item) => {
        const details = activity(item.type);
        const Icon = details.icon;
        return <article className={`notifications-item ${item.readAt ? "" : "unread"}`} key={item.id}>
          <span className="notifications-icon"><Icon size={19} /></span>
          <button className="notifications-copy" type="button" disabled={busyId === item.id} onClick={() => void open(item)} aria-label={`Open ${item.targetTitle}`}><strong>{item.actorDisplayName} {details.action}</strong><span>{item.targetTitle}</span>{item.details && <span className="notifications-details">{item.details}</span>}<small>@{item.actorUsername} · {dateTimeFormatter.format(new Date(item.createdAt))}</small></button>
          <div className="notifications-item-actions">{!item.readAt && <button type="button" disabled={busyId === item.id} onClick={() => void markRead(item)}><Check size={15} /> Mark read</button>}</div>
        </article>;
      })}
      {loading && page > 0 && <p className="notifications-loading"><LoaderCircle className="notifications-spin" size={16} /> Loading more...</p>}
      {hasMore && !loading && <button className="notifications-load-more" type="button" onClick={() => setPage((value) => value + 1)}>Load more</button>}
    </div>
  </section>;
}
