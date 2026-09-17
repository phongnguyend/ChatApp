import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, LoaderCircle, Plus, UserRound, X } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import "./CalendarView.css";

type Person = { id: string; displayName: string; username: string };
type DraftMeeting = {
  id: string;
  title: string;
  description: string;
  date: string;
  start: string;
  end: string;
  people: Person[];
};
type MeetingForm = Omit<DraftMeeting, "id">;

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

function newForm(date: string, start: string): MeetingForm {
  return {
    title: "",
    description: "",
    date,
    start,
    end: timeValue(Math.min(minutesFromTime(start) + 60, 23 * 60 + 59)),
    people: [],
  };
}

export function CalendarView({
  apiUrl,
  currentUsername,
  onBack,
  hidden,
}: {
  apiUrl: string;
  currentUsername: string;
  onBack: () => void;
  hidden: boolean;
}) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [miniMonth, setMiniMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [pickerMonth, setPickerMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [isWeekPickerOpen, setIsWeekPickerOpen] = useState(false);
  const [meetings, setMeetings] = useState<DraftMeeting[]>([]);
  const [form, setForm] = useState<MeetingForm | null>(null);
  const [personQuery, setPersonQuery] = useState("");
  const [userResults, setUserResults] = useState<Person[]>([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const [peopleSearchError, setPeopleSearchError] = useState("");
  const [isPeopleOpen, setIsPeopleOpen] = useState(false);
  const [activePersonIndex, setActivePersonIndex] = useState(0);
  const [formError, setFormError] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
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
    if (!isFormOpen) return;
    titleInputRef.current?.focus();
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setForm(null);
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [isFormOpen]);

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

  function openForm(date: string, start: string) {
    setForm(newForm(date, start));
    setPersonQuery("");
    setUserResults([]);
    setIsPeopleOpen(false);
    setFormError("");
  }

  function addPerson(person: Person) {
    if (!form || form.people.some((selected) => selected.id === person.id)) return;
    setForm({ ...form, people: [...form.people, person] });
    setPersonQuery("");
    setActivePersonIndex(0);
    setFormError("");
    personInputRef.current?.focus();
  }

  function createMeeting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    if (!form.title.trim()) {
      setFormError("Add a meeting title.");
      return;
    }
    if (minutesFromTime(form.end) <= minutesFromTime(form.start)) {
      setFormError("End time must be after start time.");
      return;
    }
    if (personQuery.trim()) {
      setFormError("Choose a person from the search results or clear the search.");
      personInputRef.current?.focus();
      return;
    }
    const next = {
      ...form,
      title: form.title.trim(),
      description: form.description.trim(),
      id: crypto.randomUUID(),
    };
    setMeetings((current) => [...current, next]);
    goToWeek(localDate(next.date));
    setForm(null);
  }

  return (
    <section className="calendar-view" aria-label="Calendar" hidden={hidden}>
      <div className="calendar-toolbar">
        <div>
          <p className="eyebrow">Your schedule</p>
          <h1>Calendar</h1>
          <p className="calendar-intro">Plan a time together. Meetings here are a preview until scheduling is connected.</p>
        </div>
        <div className="calendar-toolbar-actions">
          <button className="calendar-back" type="button" onClick={onBack}>Back to chat</button>
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
        </div>
      </div>
      <div className="calendar-grid-scroll">
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
          <div className="calendar-time-column">
            {slots.map((minutes) => <div key={minutes}>{minutes % 60 === 0 ? timeLabel(minutes) : ""}</div>)}
          </div>
          {weekDays.map((date) => {
            const key = dateKey(date);
            const dayMeetings = meetings.filter((meeting) => meeting.date === key);
            return (
              <div className={`calendar-day-column ${key === today ? "today" : ""}`} key={key}>
                {slots.map((minutes) => {
                  const slotMeetings = dayMeetings.filter((meeting) => {
                    const start = minutesFromTime(meeting.start);
                    return start >= minutes && start < minutes + SLOT_MINUTES;
                  });
                  return (
                    <button
                      className={`calendar-slot ${slotMeetings.length > 0 ? "has-meeting" : ""}`}
                      key={minutes}
                      type="button"
                      aria-label={`${new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(date)}, ${timeLabel(minutes)}. Create meeting`}
                      onClick={() => openForm(key, timeValue(minutes))}
                    >
                      {slotMeetings.slice(0, 1).map((meeting) => (
                        <span className="calendar-meeting" key={meeting.id} title={`${meeting.title} · ${meeting.start}–${meeting.end}${meeting.description ? `\n${meeting.description}` : ""}`}>
                          <strong>{meeting.title}</strong>
                          <small>{meeting.start}–{meeting.end}</small>
                        </span>
                      ))}
                      {slotMeetings.length > 1 && <span className="calendar-more">+{slotMeetings.length - 1}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <div className="calendar-footnote">Preview only · Meetings are visible in this tab until you reload the page.</div>
        </div>
      </div>

      {form && (
        <div className="calendar-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setForm(null); }}>
          <form className="calendar-dialog" role="dialog" aria-modal="true" aria-labelledby="calendar-dialog-title" onSubmit={createMeeting}>
            <div className="calendar-dialog-heading">
              <div><p className="eyebrow">Schedule together</p><h2 id="calendar-dialog-title">New meeting</h2></div>
              <button type="button" aria-label="Close meeting form" onClick={() => setForm(null)}><X size={19} /></button>
            </div>
            <label htmlFor="calendar-title">Title</label>
            <input id="calendar-title" ref={titleInputRef} placeholder="What are you meeting about?" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
            <div className="calendar-date-time">
              <div><label htmlFor="calendar-date">Date</label><input id="calendar-date" type="date" required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></div>
              <div><label htmlFor="calendar-start">Start</label><input id="calendar-start" type="time" required value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} /></div>
              <div><label htmlFor="calendar-end">End</label><input id="calendar-end" type="time" required value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })} /></div>
            </div>
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
            <p className="calendar-form-note"><Clock3 size={15} /> This is a UI preview. No invitations will be sent.</p>
            {formError && <p className="calendar-form-error" role="alert">{formError}</p>}
            <div className="calendar-dialog-actions">
              <button type="button" onClick={() => setForm(null)}>Cancel</button>
              <button type="submit"><Check size={16} /> Add preview meeting</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
