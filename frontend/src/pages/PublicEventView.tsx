import { useEffect, useState } from 'react';
import { CalendarPlus, Download } from 'lucide-react';
import { API_URL } from '../services/auth';
import '../components/CalendarSharing.css';

type SharedEvent = {
  title: string; description: string; status: string; startDate: string; endDate: string;
  start: string | null; end: string | null; allDay: boolean; timeZoneId: string | null;
  calendarStart: string; calendarEnd: string;
};

export function PublicEventView({ token }: { token: string }) {
  const [event, setEvent] = useState<SharedEvent | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    document.head.append(meta);
    fetch(`${API_URL}/api/calendar/events/${encodeURIComponent(token)}`, { signal: controller.signal, referrerPolicy: 'no-referrer', cache: 'no-store' })
      .then(async response => {
        if (!response.ok) {
          throw new Error(response.status === 404 ? 'This event link is unavailable or has been disabled.' : 'Could not load the event. Please try again.');
        }
        setEvent(await response.json());
      }).catch(reason => {
        if (!controller.signal.aborted) {
          setError(reason.message);
        }
      });
    return () => {
      controller.abort();
      meta.remove();
    };
  }, [token]);
  const compact = (value: string) => value.replaceAll('-', '').replaceAll(':', '');
  const google = event ? `https://calendar.google.com/calendar/render?${new URLSearchParams({ action: 'TEMPLATE', text: event.title,
    details: event.description, dates: `${compact(event.calendarStart)}/${compact(event.calendarEnd)}` })}` : '';
  const outlook = event ? `https://outlook.live.com/calendar/0/deeplink/compose?${new URLSearchParams({ path: '/calendar/action/compose', rru: 'addevent',
    subject: event.title, body: event.description, startdt: event.calendarStart, enddt: event.calendarEnd, allday: String(event.allDay) })}` : '';
  return <main className="public-event"><article>
    <p>HUDDLE EVENT</p>
    {error ? <><h1>Event unavailable</h1><p role="alert">{error}</p></> : !event ? <p role="status">Loading event…</p> : <>
      <h1>{event.title}</h1>
      {event.status === 'cancelled' && <p role="status"><strong>This event has been cancelled.</strong></p>}
      <p>{event.startDate}{event.endDate !== event.startDate && ` – ${event.endDate}`} · {event.allDay ? 'All day' : `${event.start} – ${event.end}`}</p>
      {!event.allDay && <p>Time zone: {event.timeZoneId || 'Unspecified. Confirm the intended time zone with the organizer.'}</p>}
      <p className="public-event-description">{event.description}</p>
      <div className="calendar-share-actions">
        <a href={`${API_URL}/api/calendar/events/${encodeURIComponent(token)}/calendar.ics`} referrerPolicy="no-referrer"><Download size={16} />Download .ics</a>
        {event.status !== 'cancelled' && <><a href={google} target="_blank" rel="noreferrer"><CalendarPlus size={16} />Add to Google Calendar</a><a href={outlook} target="_blank" rel="noreferrer"><CalendarPlus size={16} />Add to Outlook</a></>}
      </div>
      <p className="public-event-note">This page shows the latest event details. Downloading or adding it to your calendar creates a copy that does not automatically update. For ongoing updates, invited Huddle users can use Subscribe to calendar in their account.</p>
    </>}
  </article></main>;
}
