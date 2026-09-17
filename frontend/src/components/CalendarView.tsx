import { CalendarDays, CalendarX2, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, LoaderCircle, MessageCircle, Pencil, Plus, UserRound, Video, X } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import "./CalendarView.css";

type Person = { id: string; displayName: string; username: string };
type CalendarMeeting = {
  id: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  start: string | null;
  end: string | null;
  status: "scheduled" | "cancelled";
  organizerDisplayName: string;
  organizerUsername: string;
  canEdit: boolean;
  people: Person[];
};
type MeetingForm = Pick<CalendarMeeting, "title" | "description" | "startDate" | "endDate" | "allDay" | "people"> & { start: string; end: string };

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(body?.message || `Request failed (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

const FIRST_HOUR = 7;
const LAST_HOUR = 22;
const SLOT_MINUTES = 30;
const slots = Array.from(
  { length: ((LAST_HOUR - FIRST_HOUR) * 60) / SLOT_MINUTES },
  (_, index) => FIRST_HOUR * 60 + index * SLOT_MINUTES,
);

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localDate(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date: Date) {
  return addDays(date, -date.getDay());
}

function MiniMonth({
  month,
  selectedWeek,
  today,
  onMonthChange,
  onPickWeek,
}: {
  month: Date;
  selectedWeek: string;
  today: string;
  onMonthChange: (month: Date) => void;
  onPickWeek: (date: Date) => void;
}) {
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const firstDay = startOfWeek(monthStart);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const dayCount = Math.max(35, Math.ceil((monthStart.getDay() + daysInMonth) / 7) * 7);
  const days = Array.from({ length: dayCount }, (_, index) => addDays(firstDay, index));
  const monthLabel = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(monthStart);

  return (
    <div className="mini-month">
      <div className="mini-month-heading">
        <strong>{monthLabel}</strong>
        <div>
          <button type="button" aria-label="Previous month" onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={15} /></button>
          <button type="button" aria-label="Next month" onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={15} /></button>
        </div>
      </div>
      <div className="mini-month-weekdays" aria-hidden="true">
        {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={index}>{day}</span>)}
      </div>
      <div className="mini-month-days">
        {days.map((date) => {
          const key = dateKey(date);
          const inSelectedWeek = dateKey(startOfWeek(date)) === selectedWeek;
          return (
            <button
              key={key}
              type="button"
              className={[
                date.getMonth() === month.getMonth() ? "" : "outside-month",
                inSelectedWeek ? "selected-week" : "",
                date.getDay() === 0 ? "week-start" : "",
                date.getDay() === 6 ? "week-end" : "",
                key === today ? "today" : "",
              ].filter(Boolean).join(" ")}
              aria-label={`Week of ${new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(startOfWeek(date))}`}
              aria-pressed={inSelectedWeek}
              aria-current={key === today ? "date" : undefined}
              onClick={() => onPickWeek(date)}
            ><span>{date.getDate()}</span></button>
          );
        })}
      </div>
    </div>
  );
}

function timeLabel(minutes: number) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    new Date(2020, 0, 1, Math.floor(minutes / 60), minutes % 60),
  );
}

function timeValue(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function newForm(date: string, start: string, allDay = false): MeetingForm {
  return {
    title: "",
    description: "",
    startDate: date,
    endDate: date,
    allDay,
    start,
    end: timeValue(Math.min(minutesFromTime(start) + 60, 23 * 60 + 59)),
    people: [],
  };
}

export function CalendarView({
  apiUrl,
  currentUsername,
  onBack,
  onOpenConversation,
  hidden,
}: {
  apiUrl: string;
  currentUsername: string;
  onBack: () => void;
  onOpenConversation: (conversationId: string, action: "chat" | "join") => Promise<void>;
  hidden: boolean;
}) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [miniMonth, setMiniMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [pickerMonth, setPickerMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [isWeekPickerOpen, setIsWeekPickerOpen] = useState(false);
  const [meetings, setMeetings] = useState<CalendarMeeting[]>([]);
  const [calendarError, setCalendarError] = useState("");
  const [isLoadingMeetings, setIsLoadingMeetings] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [form, setForm] = useState<MeetingForm | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedMeeting, setSelectedMeeting] = useState<CalendarMeeting | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isOpeningConversation, setIsOpeningConversation] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [personQuery, setPersonQuery] = useState("");
  const [userResults, setUserResults] = useState<Person[]>([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const [peopleSearchError, setPeopleSearchError] = useState("");
  const [isPeopleOpen, setIsPeopleOpen] = useState(false);
  const [activePersonIndex, setActivePersonIndex] = useState(0);
  const [formError, setFormError] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const detailRequestRef = useRef(0);
  const personInputRef = useRef<HTMLInputElement>(null);
  const peoplePickerRef = useRef<HTMLDivElement>(null);
  const weekPickerRef = useRef<HTMLDivElement>(null);
  const isFormOpen = form !== null;
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const today = dateKey(new Date());
  const weekEnd = weekDays[6];
  const weekLabel = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(weekStart);
  const endLabel = new Intl.DateTimeFormat(undefined, {
    month: weekStart.getMonth() === weekEnd.getMonth() ? undefined : "short",
    day: "numeric",
    year: "numeric",
  }).format(weekEnd);

  const suggestions = userResults.filter((person) => !form?.people.some((selected) => selected.id === person.id));

  useEffect(() => {
    if (hidden) return;
    const controller = new AbortController();
    setIsLoadingMeetings(true);
    setCalendarError("");
    const from = dateKey(weekStart);
    const to = dateKey(addDays(weekStart, 6));
    fetch(`${apiUrl}/api/meetings?username=${encodeURIComponent(currentUsername)}&from=${from}&to=${to}`, { signal: controller.signal })
      .then((response) => readResponse<CalendarMeeting[]>(response))
      .then(setMeetings)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setMeetings([]);
        setCalendarError(error instanceof Error ? error.message : "Could not load meetings.");
      })
      .finally(() => { if (!controller.signal.aborted) setIsLoadingMeetings(false); });
    return () => controller.abort();
  }, [apiUrl, currentUsername, hidden, weekStart, refreshVersion]);

  useEffect(() => {
    if (!isFormOpen) return;
    titleInputRef.current?.focus();
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) setForm(null);
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [isFormOpen, isSaving]);

  useEffect(() => {
    if (!selectedMeeting) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isCancelling && !isOpeningConversation) closeDetails();
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [selectedMeeting, isCancelling, isOpeningConversation]);

  useEffect(() => {
    if (!isFormOpen || !isPeopleOpen) return;
    const controller = new AbortController();
    setIsSearchingUsers(true);
    setPeopleSearchError("");
    const timer = window.setTimeout(() => {
      fetch(`${apiUrl}/api/users?currentUsername=${encodeURIComponent(currentUsername)}&query=${encodeURIComponent(personQuery.trim())}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Could not search people.");
          return (await response.json()) as Person[];
        })
        .then((results) => {
          setUserResults(results);
          setActivePersonIndex(0);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setUserResults([]);
          setPeopleSearchError(error instanceof Error ? error.message : "Could not search people.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsSearchingUsers(false);
        });
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [apiUrl, currentUsername, isFormOpen, isPeopleOpen, personQuery]);

  useEffect(() => {
    if (!isPeopleOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!peoplePickerRef.current?.contains(event.target as Node)) setIsPeopleOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [isPeopleOpen]);

  useEffect(() => {
    if (!isWeekPickerOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!weekPickerRef.current?.contains(event.target as Node)) setIsWeekPickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsWeekPickerOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isWeekPickerOpen]);

  function goToWeek(date: Date) {
    setWeekStart(startOfWeek(date));
    setMiniMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    setIsWeekPickerOpen(false);
  }

  function openForm(date: string, start: string, allDay = false) {
    detailRequestRef.current += 1;
    setSelectedMeeting(null);
    setEditingId(null);
    setForm(newForm(date, start, allDay));
    setPersonQuery("");
    setUserResults([]);
    setIsPeopleOpen(false);
    setFormError("");
  }

  async function openDetails(meeting: CalendarMeeting) {
    const requestId = ++detailRequestRef.current;
    setForm(null);
    setSelectedMeeting(meeting);
    setDetailError("");
    setConfirmCancel(false);
    setIsLoadingDetail(true);
    try {
      const response = await fetch(`${apiUrl}/api/meetings/${meeting.id}?username=${encodeURIComponent(currentUsername)}`);
      const current = await readResponse<CalendarMeeting>(response);
      if (detailRequestRef.current === requestId) setSelectedMeeting(current);
    } catch (error) {
      if (detailRequestRef.current === requestId) setDetailError(error instanceof Error ? error.message : "Could not load meeting details.");
    } finally {
      if (detailRequestRef.current === requestId) setIsLoadingDetail(false);
    }
  }

  function closeDetails() {
    detailRequestRef.current += 1;
    setSelectedMeeting(null);
  }

  function editMeeting(meeting: CalendarMeeting) {
    if (!meeting.canEdit || meeting.status === "cancelled") return;
    setEditingId(meeting.id);
    setForm({
      title: meeting.title,
      description: meeting.description,
      startDate: meeting.startDate,
      endDate: meeting.endDate,
      allDay: meeting.allDay,
      start: meeting.start ?? "09:00",
      end: meeting.end ?? "10:00",
      people: meeting.people,
    });
    closeDetails();
    setPersonQuery("");
    setUserResults([]);
    setIsPeopleOpen(false);
    setFormError("");
  }

  async function cancelMeeting() {
    if (!selectedMeeting?.canEdit || selectedMeeting.status === "cancelled") return;
    setIsCancelling(true);
    setDetailError("");
    try {
      const response = await fetch(`${apiUrl}/api/meetings/${selectedMeeting.id}/cancel?username=${encodeURIComponent(currentUsername)}`, { method: "POST" });
      const updated = await readResponse<CalendarMeeting>(response);
      setSelectedMeeting(updated);
      setMeetings((current) => current.map((meeting) => meeting.id === updated.id ? updated : meeting));
      setConfirmCancel(false);
      setRefreshVersion((version) => version + 1);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Could not cancel meeting.");
    } finally {
      setIsCancelling(false);
    }
  }

  async function openMeetingConversation(action: "chat" | "join") {
    if (!selectedMeeting || isOpeningConversation) return;
    setIsOpeningConversation(true);
    setDetailError("");
    try {
      const response = await fetch(`${apiUrl}/api/meetings/${selectedMeeting.id}/conversation?username=${encodeURIComponent(currentUsername)}`, { method: "POST" });
      const result = await readResponse<{ conversationId: string }>(response);
      await onOpenConversation(result.conversationId, action);
      closeDetails();
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : action === "join" ? "Could not join the meeting." : "Could not open the meeting conversation.");
    } finally {
      setIsOpeningConversation(false);
    }
  }

  function addPerson(person: Person) {
    if (!form || form.people.some((selected) => selected.id === person.id)) return;
    setForm({ ...form, people: [...form.people, person] });
    setPersonQuery("");
    setActivePersonIndex(0);
    setFormError("");
    personInputRef.current?.focus();
  }

  async function saveMeeting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    if (form.title.trim().length < 2) {
      setFormError("Add a meeting title with at least two characters.");
      return;
    }
    if (!form.startDate || !form.endDate || form.endDate < form.startDate) {
      setFormError("End date must be on or after start date.");
      return;
    }
    if (!form.allDay && form.endDate === form.startDate && minutesFromTime(form.end) <= minutesFromTime(form.start)) {
      setFormError("End time must be after start time.");
      return;
    }
    if (personQuery.trim()) {
      setFormError("Choose a person from the search results or clear the search.");
      personInputRef.current?.focus();
      return;
    }
    setIsSaving(true);
    setFormError("");
    try {
      const response = await fetch(`${apiUrl}/api/meetings${editingId ? `/${editingId}` : ""}?username=${encodeURIComponent(currentUsername)}`, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, title: form.title.trim(), description: form.description.trim(), start: form.allDay ? null : form.start, end: form.allDay ? null : form.end, people: form.people.map((person) => person.id) }),
      });
      const saved = await readResponse<CalendarMeeting>(response);
      setForm(null);
      setEditingId(null);
      setSelectedMeeting(saved);
      goToWeek(localDate(saved.startDate));
      setRefreshVersion((version) => version + 1);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not save meeting.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="calendar-view" aria-label="Calendar" hidden={hidden}>
      <div className="calendar-toolbar">
        <div>
          <p className="eyebrow">Your schedule</p>
          <h1>Calendar</h1>
          <p className="calendar-intro">Plan a time together and keep your meetings in one place.</p>
        </div>
        <div className="calendar-toolbar-actions">
          <button className="calendar-back" type="button" onClick={() => { setForm(null); closeDetails(); onBack(); }}>Back to chat</button>
          <button className="calendar-create" type="button" onClick={() => openForm(today, "09:00")}>
            <Plus size={17} /> New meeting
          </button>
        </div>
      </div>
      <div className="calendar-content">
        <aside className="calendar-mini-sidebar" aria-label="Choose a week">
          <MiniMonth
            month={miniMonth}
            selectedWeek={dateKey(weekStart)}
            today={today}
            onMonthChange={setMiniMonth}
            onPickWeek={goToWeek}
          />
          <p>Select any date to view its week.</p>
        </aside>
        <div className="calendar-main">
      <div className="calendar-week-toolbar">
        <div className="calendar-week-selector" ref={weekPickerRef}>
          <button
            className="calendar-week-trigger"
            type="button"
            aria-label={`Choose week. Current week: ${weekLabel} to ${endLabel}`}
            aria-expanded={isWeekPickerOpen}
            aria-haspopup="dialog"
            onClick={() => {
              setPickerMonth(new Date(weekStart.getFullYear(), weekStart.getMonth(), 1));
              setIsWeekPickerOpen((open) => !open);
            }}
          >
            <CalendarDays size={18} />
            <strong>{weekLabel} – {endLabel}</strong>
            <ChevronDown size={15} />
          </button>
          {isWeekPickerOpen && (
            <div className="calendar-week-popover" role="dialog" aria-label="Choose a week">
              <MiniMonth
                month={pickerMonth}
                selectedWeek={dateKey(weekStart)}
                today={today}
                onMonthChange={setPickerMonth}
                onPickWeek={goToWeek}
              />
              <div className="calendar-month-jump">
                <div className="calendar-year-heading">
                  <strong>{pickerMonth.getFullYear()}</strong>
                  <div>
                    <button type="button" aria-label="Previous year" onClick={() => setPickerMonth(new Date(pickerMonth.getFullYear() - 1, pickerMonth.getMonth(), 1))}><ChevronLeft size={15} /></button>
                    <button type="button" aria-label="Next year" onClick={() => setPickerMonth(new Date(pickerMonth.getFullYear() + 1, pickerMonth.getMonth(), 1))}><ChevronRight size={15} /></button>
                  </div>
                </div>
                <div className="calendar-month-grid">
                  {Array.from({ length: 12 }, (_, month) => (
                    <button
                      type="button"
                      key={month}
                      className={pickerMonth.getMonth() === month ? "active" : ""}
                      aria-label={new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(pickerMonth.getFullYear(), month, 1))}
                      onClick={() => setPickerMonth(new Date(pickerMonth.getFullYear(), month, 1))}
                    >{new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(pickerMonth.getFullYear(), month, 1))}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="calendar-week-actions">
          <button type="button" onClick={() => goToWeek(new Date())}>Today</button>
          <button type="button" aria-label="Previous week" onClick={() => goToWeek(addDays(weekStart, -7))}><ChevronLeft size={18} /></button>
          <button type="button" aria-label="Next week" onClick={() => goToWeek(addDays(weekStart, 7))}><ChevronRight size={18} /></button>
          <button type="button" onClick={() => setRefreshVersion((version) => version + 1)}>Refresh</button>
        </div>
      </div>
      <div className="calendar-grid-scroll">
        {(isLoadingMeetings || calendarError) && <div className={`calendar-load-state ${calendarError ? "error" : ""}`} role={calendarError ? "alert" : "status"}>{calendarError || "Loading meetings…"}{calendarError && <button type="button" onClick={() => setRefreshVersion((version) => version + 1)}>Retry</button>}</div>}
        <div className="calendar-grid">
          <div className="calendar-time-heading" aria-hidden="true">GMT{new Date().getTimezoneOffset() <= 0 ? "+" : "-"}{Math.abs(new Date().getTimezoneOffset() / 60)}</div>
          {weekDays.map((date) => {
            const key = dateKey(date);
            return (
              <div className={`calendar-day-heading ${key === today ? "today" : ""}`} key={key}>
                <span>{new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date)}</span>
                <strong>{date.getDate()}</strong>
              </div>
            );
          })}
          <div className="calendar-all-day-label">All day</div>
          {weekDays.map((date) => {
            const key = dateKey(date);
            const spanningMeetings = meetings.filter((meeting) =>
              (meeting.allDay || meeting.startDate !== meeting.endDate || (meeting.start !== null && (minutesFromTime(meeting.start) < FIRST_HOUR * 60 || minutesFromTime(meeting.start) >= LAST_HOUR * 60))) &&
              meeting.startDate <= key && key <= meeting.endDate,
            );
            return (
              <div
                className="calendar-day-events"
                key={key}
              >
                <button className="calendar-day-events-create" type="button" aria-label={`${new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(date)}. Create all-day meeting`} onClick={() => openForm(key, "09:00", true)} />
                {spanningMeetings.map((meeting) => (
                  <button
                    type="button"
                    className={`calendar-spanning-meeting ${meeting.status === "cancelled" ? "cancelled" : ""}`}
                    key={meeting.id}
                    title={`${meeting.title} · ${meeting.status === "cancelled" ? "Cancelled · " : ""}${meeting.allDay ? "All day" : `${meeting.start}–${meeting.end}`} · ${meeting.startDate}–${meeting.endDate}`}
                    onClick={() => void openDetails(meeting)}
                  >
                    {!meeting.allDay && <Clock3 size={11} aria-hidden="true" />}
                    <span>{meeting.title}</span>
                  </button>
                ))}
              </div>
            );
          })}
          <div className="calendar-time-column">
            {slots.map((minutes) => <div key={minutes}>{minutes % 60 === 0 ? timeLabel(minutes) : ""}</div>)}
          </div>
          {weekDays.map((date) => {
            const key = dateKey(date);
            const dayMeetings = meetings.filter((meeting) => !meeting.allDay && meeting.startDate === key && meeting.endDate === key);
            return (
              <div className={`calendar-day-column ${key === today ? "today" : ""}`} key={key}>
                {slots.map((minutes) => {
                  const slotMeetings = dayMeetings.filter((meeting) => {
                    const start = minutesFromTime(meeting.start ?? "00:00");
                    return start >= minutes && start < minutes + SLOT_MINUTES;
                  });
                  return (
                    <div
                      className={`calendar-slot ${slotMeetings.length > 0 ? "has-meeting" : ""}`}
                      key={minutes}
                    >
                      <button className="calendar-slot-create" type="button" aria-label={`${new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(date)}, ${timeLabel(minutes)}. Create meeting`} onClick={() => openForm(key, timeValue(minutes))} />
                      {slotMeetings.map((meeting, index) => (
                        <button type="button" className={`calendar-meeting ${meeting.status === "cancelled" ? "cancelled" : ""}`} style={{ left: `${index * 100 / slotMeetings.length}%`, width: `${100 / slotMeetings.length}%`, right: "auto" }} key={meeting.id} title={`${meeting.title} · ${meeting.status === "cancelled" ? "Cancelled · " : ""}${meeting.start}–${meeting.end}`} onClick={() => void openDetails(meeting)}>
                          <strong>{meeting.title}</strong>
                          <small>{meeting.start}–{meeting.end}</small>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <div className="calendar-footnote">Meetings are saved and visible to their organizer and participants. Cancelled meetings remain in the calendar.</div>
        </div>
      </div>

      {form && (
        <div className="calendar-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSaving) setForm(null); }}>
          <form className="calendar-dialog" role="dialog" aria-modal="true" aria-labelledby="calendar-dialog-title" onSubmit={(event) => void saveMeeting(event)}>
            <div className="calendar-dialog-heading">
              <div><p className="eyebrow">Schedule together</p><h2 id="calendar-dialog-title">{editingId ? "Edit meeting" : "New meeting"}</h2></div>
              <button type="button" aria-label="Close meeting form" disabled={isSaving} onClick={() => setForm(null)}><X size={19} /></button>
            </div>
            <label htmlFor="calendar-title">Title</label>
            <input id="calendar-title" ref={titleInputRef} placeholder="What are you meeting about?" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
            <label className="calendar-all-day-toggle">
              <input type="checkbox" checked={form.allDay} onChange={(event) => setForm({ ...form, allDay: event.target.checked })} />
              <span>All day</span>
            </label>
            <div className="calendar-date-range">
              <div>
                <label htmlFor="calendar-start-date">Start date</label>
                <input id="calendar-start-date" type="date" required value={form.startDate} onChange={(event) => {
                  const startDate = event.target.value;
                  setForm({ ...form, startDate, endDate: form.endDate < startDate ? startDate : form.endDate });
                }} />
              </div>
              <div>
                <label htmlFor="calendar-end-date">End date</label>
                <input id="calendar-end-date" type="date" required min={form.startDate} value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} />
              </div>
            </div>
            {!form.allDay && (
              <div className="calendar-time-range">
                <div><label htmlFor="calendar-start">Start time</label><input id="calendar-start" type="time" required value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} /></div>
                <div><label htmlFor="calendar-end">End time</label><input id="calendar-end" type="time" required value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })} /></div>
              </div>
            )}
            <label htmlFor="calendar-person">People</label>
            <div className="calendar-people-picker" ref={peoplePickerRef}>
              <div className="calendar-people-input">
                {form.people.map((person) => (
                  <span className="calendar-person-chip" key={person.id} title={`@${person.username}`}>
                    {person.displayName}
                    <button type="button" aria-label={`Remove ${person.displayName}`} onClick={() => setForm({ ...form, people: form.people.filter((selected) => selected.id !== person.id) })}><X size={13} /></button>
                  </span>
                ))}
                <input
                  id="calendar-person"
                  ref={personInputRef}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={isPeopleOpen}
                  aria-controls="calendar-people-results"
                  aria-activedescendant={isPeopleOpen && !isSearchingUsers && suggestions[activePersonIndex] ? `calendar-person-option-${suggestions[activePersonIndex].id}` : undefined}
                  autoComplete="off"
                  placeholder={form.people.length ? "Add another person" : "Search people by name or username"}
                  value={personQuery}
                  onFocus={() => setIsPeopleOpen(true)}
                  onChange={(event) => {
                    setPersonQuery(event.target.value);
                    setActivePersonIndex(0);
                    setIsPeopleOpen(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setIsPeopleOpen(true);
                      if (suggestions.length) setActivePersonIndex((index) => (index + 1) % suggestions.length);
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      if (suggestions.length) setActivePersonIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
                    } else if (event.key === "Enter" && isPeopleOpen) {
                      event.preventDefault();
                      if (!isSearchingUsers && !peopleSearchError && suggestions[activePersonIndex]) {
                        addPerson(suggestions[activePersonIndex]);
                      }
                    } else if (event.key === "Escape" && isPeopleOpen) {
                      event.preventDefault();
                      event.stopPropagation();
                      setIsPeopleOpen(false);
                    }
                  }}
                />
              </div>
              {isPeopleOpen && (
                <div className="calendar-suggestions" id="calendar-people-results" role="listbox" aria-label="People search results">
                  {isSearchingUsers ? (
                    <p className="calendar-search-state" role="status"><LoaderCircle className="spin" size={15} /> Searching people…</p>
                  ) : peopleSearchError ? (
                    <p className="calendar-search-state error" role="alert">{peopleSearchError}</p>
                  ) : suggestions.length === 0 ? (
                    <p className="calendar-search-state" role="status">{personQuery.trim() ? "No people found." : "No more people to add."}</p>
                  ) : suggestions.map((person, index) => (
                    <button
                      id={`calendar-person-option-${person.id}`}
                      type="button"
                      role="option"
                      aria-selected={index === activePersonIndex}
                      className={index === activePersonIndex ? "active" : ""}
                      key={person.id}
                      onMouseEnter={() => setActivePersonIndex(index)}
                      onClick={() => addPerson(person)}
                    >
                      <UserRound size={16} />
                      <span><strong>{person.displayName}</strong><small>@{person.username}</small></span>
                      <Plus size={14} />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <label className="calendar-description-label" htmlFor="calendar-description">Description <span className="calendar-optional">Optional</span></label>
            <textarea
              id="calendar-description"
              rows={4}
              placeholder="Add an agenda or a few details for this meeting"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
            <p className="calendar-form-note"><Clock3 size={15} /> Participants can see this meeting in their calendar. No email invitations are sent.</p>
            {formError && <p className="calendar-form-error" role="alert">{formError}</p>}
            <div className="calendar-dialog-actions">
              <button type="button" disabled={isSaving} onClick={() => setForm(null)}>Close</button>
              <button type="submit" disabled={isSaving}>{isSaving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} {editingId ? "Save changes" : "Create meeting"}</button>
            </div>
          </form>
        </div>
      )}

      {selectedMeeting && !form && (
        <div className="calendar-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !isCancelling && !isOpeningConversation) closeDetails(); }}>
          <div className="calendar-dialog calendar-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="calendar-detail-title">
            <div className="calendar-dialog-heading">
              <div><p className="eyebrow">Meeting details</p><h2 id="calendar-detail-title">{selectedMeeting.title}</h2></div>
              <button type="button" aria-label="Close meeting details" disabled={isCancelling || isOpeningConversation} onClick={closeDetails}><X size={19} /></button>
            </div>
            {selectedMeeting.status === "cancelled" && <p className="calendar-cancelled-badge">Cancelled</p>}
            <p className="calendar-detail-line"><CalendarDays size={16} /> {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(localDate(selectedMeeting.startDate))}{selectedMeeting.endDate !== selectedMeeting.startDate ? ` – ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(localDate(selectedMeeting.endDate))}` : ""}</p>
            <p className="calendar-detail-line"><Clock3 size={16} /> {selectedMeeting.allDay ? "All day" : `${selectedMeeting.start} – ${selectedMeeting.end}`}</p>
            <div className="calendar-detail-section"><strong>Organizer</strong><p>{selectedMeeting.organizerDisplayName} (@{selectedMeeting.organizerUsername})</p></div>
            <div className="calendar-detail-section"><strong>People</strong><p>{selectedMeeting.people.length ? selectedMeeting.people.map((person) => `${person.displayName} (@${person.username})`).join(", ") : "Only the organizer"}</p></div>
            {selectedMeeting.description && <div className="calendar-detail-section"><strong>Description</strong><p className="calendar-detail-description">{selectedMeeting.description}</p></div>}
            {isLoadingDetail && <p role="status" className="calendar-form-note"><LoaderCircle className="spin" size={15} /> Loading current details…</p>}
            {detailError && <p role="alert" className="calendar-form-error">{detailError}</p>}
            {confirmCancel && <p className="calendar-cancel-confirm">Cancel this meeting for everyone? It will remain visible as cancelled.</p>}
            <div className="calendar-dialog-actions">
              {!confirmCancel && (
                <>
                  <button type="button" disabled={isLoadingDetail || isOpeningConversation || isCancelling} onClick={() => void openMeetingConversation("chat")}><MessageCircle size={14} aria-hidden="true" />{isOpeningConversation ? "Opening…" : "Chat"}</button>
                  {selectedMeeting.status !== "cancelled" && <button className="calendar-join-button" type="button" disabled={isLoadingDetail || isOpeningConversation || isCancelling} onClick={() => void openMeetingConversation("join")}><Video size={14} aria-hidden="true" />{isOpeningConversation ? "Opening…" : "Join"}</button>}
                </>
              )}
              {selectedMeeting.canEdit && selectedMeeting.status !== "cancelled" && (
                <>
                  <button type="button" disabled={isLoadingDetail || isCancelling} onClick={() => confirmCancel ? void cancelMeeting() : setConfirmCancel(true)}><CalendarX2 size={14} aria-hidden="true" />{isCancelling ? "Cancelling…" : confirmCancel ? "Confirm cancellation" : "Cancel meeting"}</button>
                  {!confirmCancel && <button type="button" disabled={isLoadingDetail} onClick={() => editMeeting(selectedMeeting)}><Pencil size={14} aria-hidden="true" />Edit meeting</button>}
                  {confirmCancel && <button type="button" disabled={isCancelling} onClick={() => setConfirmCancel(false)}><Check size={14} aria-hidden="true" />Keep meeting</button>}
                </>
              )}
              <button type="button" disabled={isCancelling || isOpeningConversation} onClick={closeDetails}><X size={14} aria-hidden="true" />Close</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
