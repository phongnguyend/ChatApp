import { ArrowLeft, CalendarDays, CalendarX2, Check, CheckCircle2, Clock3, HelpCircle, LoaderCircle, MessageCircle, Pencil, Plus, Search, UserRound, Users, Video, X, XCircle } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import "./MeetingsView.css";

type MeetingResponse = "pending" | "accepted" | "tentative" | "declined";
type Person = { id: string; username: string; displayName: string; responseStatus?: MeetingResponse; respondedAt?: string | null };
type Meeting = {
  id: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  start: string | null;
  end: string | null;
  status: "scheduled" | "cancelled";
  organizerUserId: string;
  organizerDisplayName: string;
  organizerUsername: string;
  canEdit: boolean;
  viewerResponseStatus: MeetingResponse | null;
  people: Person[];
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
};
type MeetingForm = Pick<Meeting, "title" | "description" | "startDate" | "endDate" | "allDay" | "people"> & { start: string; end: string };
type MeetingPage = { items: Meeting[]; hasMore: boolean };
type MeetingFilters = { from: string; to: string; name: string; organizer: string; participant: string };
const emptyFilters = (): MeetingFilters => ({ from: "", to: "", name: "", organizer: "", participant: "" });

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(body?.message || `Request failed (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(year, month - 1, day));
}

function dateRange(meeting: Meeting) {
  return meeting.startDate === meeting.endDate
    ? formatDate(meeting.startDate)
    : `${formatDate(meeting.startDate)} – ${formatDate(meeting.endDate)}`;
}

function timeRange(meeting: Meeting) {
  return meeting.allDay ? "All day" : `${meeting.start} – ${meeting.end}`;
}

function responseLabel(response: MeetingResponse | undefined | null) {
  return response === "accepted" ? "Accepted"
    : response === "tentative" ? "Maybe"
    : response === "declined" ? "Declined"
    : "Awaiting response";
}

function newForm(): MeetingForm {
  const today = dateKey(new Date());
  return { title: "", description: "", startDate: today, endDate: today, allDay: false, start: "09:00", end: "10:00", people: [] };
}

export function MeetingsView({ apiUrl, currentUsername, onBack, onOpenConversation, openTarget, hidden }: {
  apiUrl: string;
  currentUsername: string;
  onBack: () => void;
  onOpenConversation: (conversationId: string, action: "chat" | "join") => Promise<void>;
  openTarget?: { id: string; request: number } | null;
  hidden: boolean;
}) {
  const [tab, setTab] = useState<"created" | "invited">("created");
  const [filtersByTab, setFiltersByTab] = useState({ created: emptyFilters(), invited: emptyFilters() });
  const [page, setPage] = useState(0);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [openingConversation, setOpeningConversation] = useState(false);
  const [responding, setResponding] = useState(false);
  const [form, setForm] = useState<MeetingForm | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [peopleQuery, setPeopleQuery] = useState("");
  const [peopleResults, setPeopleResults] = useState<Person[]>([]);
  const [peopleError, setPeopleError] = useState("");
  const [searchingPeople, setSearchingPeople] = useState(false);
  const detailRequest = useRef(0);
  const isFormOpen = form !== null;
  const filters = filtersByTab[tab];
  const hasFilters = Object.values(filters).some((value) => value.trim() !== "");
  const filterDateError = filters.from && filters.to && filters.from > filters.to
    ? "The end date must be on or after the start date." : "";

  useEffect(() => {
    if (hidden || !openTarget) return;
    const controller = new AbortController();
    const request = ++detailRequest.current;
    setDetailLoading(true);
    setDetailError("");
    setConfirmCancel(false);
    fetch(`${apiUrl}/api/meetings/${openTarget.id}?username=${encodeURIComponent(currentUsername)}`, { signal: controller.signal })
      .then((response) => readResponse<Meeting>(response))
      .then((meeting) => {
        if (controller.signal.aborted || detailRequest.current !== request) return;
        setTab(meeting.canEdit ? "created" : "invited");
        setMeetings((current) => [meeting, ...current.filter((item) => item.id !== meeting.id)]);
        setSelected(meeting);
      })
      .catch((reason) => { if (!controller.signal.aborted && detailRequest.current === request) setDetailError(reason instanceof Error ? reason.message : "Could not open meeting."); })
      .finally(() => { if (!controller.signal.aborted && detailRequest.current === request) setDetailLoading(false); });
    return () => controller.abort();
  }, [apiUrl, currentUsername, hidden, openTarget]);

  useEffect(() => {
    if (hidden) return;
    if (filterDateError) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ username: currentUsername, tab, page: String(page) });
    for (const key of ["from", "to", "name", "organizer", "participant"] as const) {
      const value = filters[key].trim();
      if (value && (key !== "organizer" || tab === "invited")) params.set(key, value);
    }
    const timer = window.setTimeout(() => {
      fetch(`${apiUrl}/api/meetings/manage?${params}`, { signal: controller.signal })
        .then((response) => readResponse<MeetingPage>(response))
        .then((result) => {
          if (controller.signal.aborted) return;
          setMeetings((current) => page === 0 ? result.items : [...current, ...result.items]);
          setHasMore(result.hasMore);
        })
        .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load meetings."); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, page === 0 ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [apiUrl, currentUsername, hidden, tab, page, refreshVersion, filters, filterDateError]);

  useEffect(() => {
    if (!isFormOpen || !peopleQuery.trim()) { setPeopleResults([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearchingPeople(true);
      setPeopleError("");
      fetch(`${apiUrl}/api/users?currentUsername=${encodeURIComponent(currentUsername)}&query=${encodeURIComponent(peopleQuery.trim())}`, { signal: controller.signal })
        .then((response) => readResponse<Person[]>(response))
        .then((items) => { if (!controller.signal.aborted) setPeopleResults(items); })
        .catch((reason) => { if (!controller.signal.aborted) setPeopleError(reason instanceof Error ? reason.message : "Could not search people."); })
        .finally(() => { if (!controller.signal.aborted) setSearchingPeople(false); });
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [apiUrl, currentUsername, isFormOpen, peopleQuery]);

  function changeTab(next: "created" | "invited") {
    if (next === tab) return;
    setTab(next);
    setPage(0);
    setMeetings([]);
    setHasMore(false);
    setSelected(null);
  }

  function updateFilter(key: keyof MeetingFilters, value: string) {
    setFiltersByTab((current) => ({ ...current, [tab]: { ...current[tab], [key]: value } }));
    setPage(0);
    setMeetings([]);
    setHasMore(false);
  }

  function clearFilters() {
    setFiltersByTab((current) => ({ ...current, [tab]: emptyFilters() }));
    setPage(0);
    setMeetings([]);
    setHasMore(false);
  }

  async function openDetails(meeting: Meeting) {
    const request = ++detailRequest.current;
    setSelected(meeting);
    setDetailLoading(true);
    setDetailError("");
    setConfirmCancel(false);
    try {
      const response = await fetch(`${apiUrl}/api/meetings/${meeting.id}?username=${encodeURIComponent(currentUsername)}`);
      const current = await readResponse<Meeting>(response);
      if (detailRequest.current === request) setSelected(current);
    } catch (reason) { if (detailRequest.current === request) setDetailError(reason instanceof Error ? reason.message : "Could not load meeting details."); }
    finally { if (detailRequest.current === request) setDetailLoading(false); }
  }

  function closeDetails() {
    detailRequest.current += 1;
    setSelected(null);
    setConfirmCancel(false);
  }

  function openCreate() {
    closeDetails();
    setEditingId(null);
    setForm(newForm());
    setFormError("");
    setPeopleQuery("");
    setPeopleResults([]);
  }

  function openEdit(meeting: Meeting) {
    if (!meeting.canEdit || meeting.status === "cancelled") return;
    closeDetails();
    setEditingId(meeting.id);
    setForm({ title: meeting.title, description: meeting.description, startDate: meeting.startDate,
      endDate: meeting.endDate, allDay: meeting.allDay, start: meeting.start ?? "09:00",
      end: meeting.end ?? "10:00", people: meeting.people });
    setFormError("");
    setPeopleQuery("");
    setPeopleResults([]);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || saving) return;
    if (form.title.trim().length < 2 || !form.startDate || !form.endDate || form.endDate < form.startDate ||
        (!form.allDay && form.startDate === form.endDate && form.end <= form.start)) {
      setFormError("Enter a title and valid meeting dates and times.");
      return;
    }
    if (peopleQuery.trim()) { setFormError("Choose a person from the results or clear the search."); return; }
    setSaving(true);
    setFormError("");
    try {
      const response = await fetch(`${apiUrl}/api/meetings${editingId ? `/${editingId}` : ""}?username=${encodeURIComponent(currentUsername)}`, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, title: form.title.trim(), description: form.description.trim(),
          start: form.allDay ? null : form.start, end: form.allDay ? null : form.end,
          people: form.people.map((person) => person.id) }),
      });
      const saved = await readResponse<Meeting>(response);
      setForm(null);
      setEditingId(null);
      if (tab !== "created") changeTab("created");
      else setPage(0);
      setRefreshVersion((value) => value + 1);
      setSelected(saved);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Could not save meeting."); }
    finally { setSaving(false); }
  }

  async function cancel() {
    if (!selected?.canEdit || selected.status === "cancelled" || cancelling) return;
    setCancelling(true);
    setDetailError("");
    try {
      const response = await fetch(`${apiUrl}/api/meetings/${selected.id}/cancel?username=${encodeURIComponent(currentUsername)}`, { method: "POST" });
      const updated = await readResponse<Meeting>(response);
      setMeetings((current) => current.map((meeting) => meeting.id === updated.id ? updated : meeting));
      setRefreshVersion((value) => value + 1);
      setSelected(updated);
      setConfirmCancel(false);
    } catch (reason) { setDetailError(reason instanceof Error ? reason.message : "Could not cancel meeting."); }
    finally { setCancelling(false); }
  }

  async function openConversation(action: "chat" | "join") {
    if (!selected || openingConversation) return;
    setOpeningConversation(true);
    setDetailError("");
    try {
      const response = await fetch(`${apiUrl}/api/meetings/${selected.id}/conversation?username=${encodeURIComponent(currentUsername)}`, { method: "POST" });
      const result = await readResponse<{ conversationId: string }>(response);
      await onOpenConversation(result.conversationId, action);
      closeDetails();
    } catch (reason) { setDetailError(reason instanceof Error ? reason.message : "Could not open the meeting conversation."); }
    finally { setOpeningConversation(false); }
  }

  async function respond(responseValue: Exclude<MeetingResponse, "pending">) {
    if (!selected || selected.canEdit || selected.status === "cancelled" || responding) return;
    setResponding(true);
    setDetailError("");
    try {
      const response = await fetch(`${apiUrl}/api/meetings/${selected.id}/response?username=${encodeURIComponent(currentUsername)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: responseValue }),
      });
      const updated = await readResponse<Meeting>(response);
      setSelected(updated);
      setMeetings((current) => current.map((meeting) => meeting.id === updated.id ? updated : meeting));
      setRefreshVersion((value) => value + 1);
    } catch (reason) { setDetailError(reason instanceof Error ? reason.message : "Could not save your response."); }
    finally { setResponding(false); }
  }

  return <section className="meetings-view" hidden={hidden} aria-label="Meetings">
    <header className="meetings-header"><div><p className="eyebrow">YOUR SCHEDULE</p><h1>Meetings</h1><p>Find meetings you organize and meetings you have been invited to.</p></div><div className="meetings-header-actions"><button type="button" onClick={onBack}><ArrowLeft size={16} /> Back to chat</button><button className="meetings-primary" type="button" onClick={openCreate}><Plus size={17} /> New meeting</button></div></header>
    <div className="meetings-tabs" role="tablist" aria-label="Meeting sections"><button type="button" role="tab" aria-selected={tab === "created"} onClick={() => changeTab("created")}><CalendarDays size={15} /> Organized by me</button><button type="button" role="tab" aria-selected={tab === "invited"} onClick={() => changeTab("invited")}><Users size={15} /> Invited to</button></div>
    <div className="meetings-filters" role="search" aria-label="Filter meetings">
      <div className="meetings-filter-heading"><strong>Filters</strong>{hasFilters && <button type="button" onClick={clearFilters}><X size={14} /> Clear filters</button>}</div>
      <div className="meetings-filter-fields">
        <label>From date<input type="date" value={filters.from} onChange={(event) => updateFilter("from", event.target.value)} /></label>
        <label>To date<input type="date" value={filters.to} onChange={(event) => updateFilter("to", event.target.value)} /></label>
        <label>Meeting name<input type="search" maxLength={200} placeholder="Search name" value={filters.name} onChange={(event) => updateFilter("name", event.target.value)} /></label>
        {tab === "invited" && <label>Organizer<input type="search" maxLength={100} placeholder="Name or username" value={filters.organizer} onChange={(event) => updateFilter("organizer", event.target.value)} /></label>}
        <label>Participant<input type="search" maxLength={100} placeholder="Name or username" value={filters.participant} onChange={(event) => updateFilter("participant", event.target.value)} /></label>
      </div>
      {filterDateError && <p className="meetings-error" role="alert">{filterDateError}</p>}
    </div>
    {error && <p className="meetings-error" role="alert">{error} <button type="button" onClick={() => { setPage(0); setRefreshVersion((value) => value + 1); }}>Retry</button></p>}
    <div className="meetings-list">{loading && page === 0 ? <div className="meetings-empty"><LoaderCircle className="meetings-spin" size={26} /> Loading meetings...</div> : meetings.length === 0 ? <div className="meetings-empty"><CalendarDays size={36} /><strong>{hasFilters ? "No meetings match your filters" : tab === "created" ? "No meetings organized by you" : "No invitations yet"}</strong><span>{hasFilters ? "Try changing or clearing the filters." : tab === "created" ? "Create a meeting to get started." : "Meetings you are invited to appear here."}</span></div> : meetings.map((meeting) => <article className="meetings-item" key={meeting.id}><button className="meetings-item-main" type="button" onClick={() => void openDetails(meeting)}><span className="meetings-item-icon"><CalendarDays size={19} /></span><span><strong>{meeting.title}</strong><small><CalendarDays size={13} /> {dateRange(meeting)} <Clock3 size={13} /> {timeRange(meeting)}</small><small>{tab === "invited" ? `Organized by ${meeting.organizerDisplayName}` : `${meeting.people.length} ${meeting.people.length === 1 ? "person" : "people"} invited`}</small></span></button><div className="meetings-item-actions">{meeting.status === "cancelled" && <span className="meetings-cancelled">Cancelled</span>}<button type="button" onClick={() => void openDetails(meeting)}>View</button>{meeting.canEdit && meeting.status !== "cancelled" && <button type="button" onClick={() => openEdit(meeting)}><Pencil size={15} /> Edit</button>}</div></article>)}{loading && page > 0 && <p className="meetings-loading"><LoaderCircle className="meetings-spin" size={16} /> Loading more...</p>}{hasMore && !loading && <button className="meetings-load-more" type="button" onClick={() => setPage((value) => value + 1)}>Load more</button>}</div>
    {selected && !form && <div className="meetings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !cancelling && !openingConversation && !responding) closeDetails(); }}>
      <div className="meetings-dialog" role="dialog" aria-modal="true" aria-labelledby="meetings-detail-title">
        <header><div><p className="eyebrow">MEETING DETAILS</p><h2 id="meetings-detail-title">{selected.title}</h2></div><button type="button" aria-label="Close meeting details" disabled={cancelling || openingConversation || responding} onClick={closeDetails}><X size={19} /></button></header>
        {selected.status === "cancelled" && <p className="meetings-cancelled">Cancelled</p>}
        <p className="meetings-detail-date"><CalendarDays size={16} /> {dateRange(selected)} <Clock3 size={16} /> {timeRange(selected)}</p>
        <div className="meetings-detail-section"><strong>Organizer</strong><p>{selected.organizerDisplayName} (@{selected.organizerUsername})</p></div>
        <div className="meetings-detail-section"><strong>People</strong>{selected.people.length ? <ul className="meetings-response-list">{selected.people.map((person) => <li key={person.id}><span>{person.displayName} <small>@{person.username}</small></span><span className={`meetings-response-status ${person.responseStatus ?? "pending"}`}>{responseLabel(person.responseStatus)}</span></li>)}</ul> : <p>Only the organizer</p>}</div>
        {!selected.canEdit && selected.status !== "cancelled" && <div className="meetings-detail-section meetings-rsvp"><strong>Your response</strong><div role="group" aria-label="Respond to meeting invitation"><button type="button" className={selected.viewerResponseStatus === "accepted" ? "active" : undefined} aria-pressed={selected.viewerResponseStatus === "accepted"} disabled={responding || detailLoading} onClick={() => void respond("accepted")}><CheckCircle2 size={15} aria-hidden="true" /> Accept</button><button type="button" className={selected.viewerResponseStatus === "tentative" ? "active" : undefined} aria-pressed={selected.viewerResponseStatus === "tentative"} disabled={responding || detailLoading} onClick={() => void respond("tentative")}><HelpCircle size={15} aria-hidden="true" /> Maybe</button><button type="button" className={selected.viewerResponseStatus === "declined" ? "active danger" : "danger"} aria-pressed={selected.viewerResponseStatus === "declined"} disabled={responding || detailLoading} onClick={() => void respond("declined")}><XCircle size={15} aria-hidden="true" /> Decline</button></div>{responding && <p className="meetings-muted" role="status"><LoaderCircle className="meetings-spin" size={15} /> Saving response...</p>}</div>}
        {selected.description && <div className="meetings-detail-section"><strong>Description</strong><p>{selected.description}</p></div>}
        {detailLoading && <p className="meetings-muted"><LoaderCircle className="meetings-spin" size={15} /> Loading current details...</p>}
        {detailError && <p className="meetings-error" role="alert">{detailError}</p>}
        {confirmCancel && <p className="meetings-error">Cancel this meeting for everyone? It will remain visible as cancelled.</p>}
        <footer><button type="button" disabled={detailLoading || openingConversation || cancelling || responding} onClick={() => void openConversation("chat")}><MessageCircle size={15} /> Chat</button>{selected.status !== "cancelled" && <button className="meetings-primary" type="button" disabled={detailLoading || openingConversation || cancelling || responding} onClick={() => void openConversation("join")}><Video size={15} /> Join</button>}{selected.canEdit && selected.status !== "cancelled" && <><button type="button" disabled={detailLoading || cancelling} onClick={() => confirmCancel ? void cancel() : setConfirmCancel(true)}><CalendarX2 size={15} /> {confirmCancel ? "Confirm cancellation" : "Cancel meeting"}</button><button type="button" disabled={detailLoading || cancelling} onClick={() => openEdit(selected)}><Pencil size={15} /> Edit meeting</button></>}<button type="button" disabled={responding} onClick={closeDetails}><X size={15} /> Close</button></footer>
      </div>
    </div>}
    {form && <div className="meetings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setForm(null); }}><form className="meetings-dialog" aria-label={editingId ? "Edit meeting" : "New meeting"} onSubmit={(event) => void save(event)}><header><h2>{editingId ? "Edit meeting" : "New meeting"}</h2><button type="button" aria-label="Close meeting form" disabled={saving} onClick={() => setForm(null)}><X size={19} /></button></header><label>Title<input autoFocus required minLength={2} maxLength={200} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="What are you meeting about?" /></label><label className="meetings-check"><input type="checkbox" checked={form.allDay} onChange={(event) => setForm({ ...form, allDay: event.target.checked })} /> All day</label><div className="meetings-form-row"><label>Start date<input type="date" required value={form.startDate} onChange={(event) => { const startDate = event.target.value; setForm({ ...form, startDate, endDate: form.endDate < startDate ? startDate : form.endDate }); }} /></label><label>End date<input type="date" required min={form.startDate} value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></label></div>{!form.allDay && <div className="meetings-form-row"><label>Start time<input type="time" required value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} /></label><label>End time<input type="time" required value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })} /></label></div>}<label>People<div className="meetings-people-field"><Search size={15} /><input value={peopleQuery} onChange={(event) => { setPeopleQuery(event.target.value); setFormError(""); }} placeholder="Search name or username" autoComplete="off" /></div></label>{peopleQuery.trim() && <div className="meetings-people-results" role="listbox" aria-label="People">{searchingPeople ? <p>Searching...</p> : peopleError ? <p className="meetings-error">{peopleError}</p> : peopleResults.filter((person) => !form.people.some((item) => item.id === person.id)).map((person) => <button type="button" role="option" aria-selected={false} key={person.id} onClick={() => { setForm({ ...form, people: [...form.people, person] }); setPeopleQuery(""); setPeopleResults([]); }}>{person.displayName} <small>@{person.username}</small></button>)}</div>}{form.people.length > 0 && <div className="meetings-people-chips">{form.people.map((person) => <span key={person.id}><UserRound size={13} />{person.displayName}<button type="button" aria-label={`Remove ${person.displayName}`} onClick={() => setForm({ ...form, people: form.people.filter((item) => item.id !== person.id) })}><X size={13} /></button></span>)}</div>}<label>Description<textarea rows={4} maxLength={4000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Add an agenda or details (optional)" /></label>{formError && <p className="meetings-error" role="alert">{formError}</p>}<footer><button type="button" disabled={saving} onClick={() => setForm(null)}>Cancel</button><button className="meetings-primary" type="submit" disabled={saving}>{saving ? <LoaderCircle className="meetings-spin" size={15} /> : <Check size={15} />}{saving ? "Saving..." : editingId ? "Save changes" : "Create meeting"}</button></footer></form></div>}
  </section>;
}
