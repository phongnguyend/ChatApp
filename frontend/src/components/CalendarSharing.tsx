import { useEffect, useId, useState } from 'react';
import { CalendarPlus, Copy, Download, ExternalLink, Link2, RefreshCw, Rss, X } from 'lucide-react';
import { API_URL, authFetch } from '../services/auth';
import { confirmDialog } from '../services/dialogs';
import { toast } from '../services/toasts';
import { localTimeZone } from '../services/calendar';
import { Modal } from './Modal';
import './CalendarSharing.css';

export function MeetingTimeZone({ value, onChange }: { value: string | null | undefined; onChange: (value: string) => void }) {
  const listId = useId();
  const zones = Intl.supportedValuesOf('timeZone');
  return <label className="calendar-time-zone">Time zone
    <input list={listId} value={value ?? ''} required maxLength={100} placeholder={localTimeZone()} onChange={event => onChange(event.target.value)} />
    <datalist id={listId}><option value="UTC" />{zones.map(zone => <option key={zone} value={zone} />)}</datalist>
    {!value && <small>This older event has no time zone. Confirm its intended time zone before saving.</small>}
  </label>;
}

async function linkRequest(path: string, action?: string): Promise<{ token: string | null }> {
  const response = await authFetch(`${API_URL}/api/calendar/${path}`, action ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
  } : undefined);
  if (!response.ok) {
    throw new Error('Could not update calendar sharing. Check your access and try again.');
  }
  return response.json();
}

function CalendarLinkDialog({ meetingId, onClose }: { meetingId?: string; onClose: () => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const path = meetingId ? `meetings/${meetingId}/share` : 'subscription';
  useEffect(() => {
    let active = true;
    linkRequest(path).then(result => {
      if (active) {
        setToken(result.token);
      }
    }).catch(() => {
      if (active) {
        setError('Could not load sharing settings. Close and try again.');
      }
    }).finally(() => {
      if (active) {
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [path]);
  const eventUrl = new URL(window.location.pathname, window.location.origin);
  eventUrl.searchParams.set('event', token ?? '');
  const url = !token ? '' : meetingId ? eventUrl.toString()
    : new URL(`${API_URL}/api/calendar/feeds/${token}/calendar.ics`, window.location.origin).toString();
  async function change(action: string) {
    if (busy || loading || error) {
      return;
    }
    setBusy(true);
    try {
      if (action !== 'enable' && !await confirmDialog(action === 'regenerate'
        ? 'Replace this link? The old link will stop working. Subscribers must add the new link.'
        : 'Disable this link? Previously imported or cached events cannot be removed from other calendar applications.')) {
        return;
      }
      setToken((await linkRequest(path, action)).token);
      toast.success(action === 'disable' ? 'Calendar link disabled.' : 'Calendar link ready.');
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'Could not update sharing.');
    } finally {
      setBusy(false);
    }
  }
  return <Modal className="calendar-link-dialog" aria-label={meetingId ? 'Share event' : 'Subscribe to calendar'} onCancel={event => {
    event.preventDefault();
    if (!busy) {
      onClose();
    }
  }}>
    <Modal.Header><h2>{meetingId ? 'Share event' : 'Subscribe to calendar'}</h2><button type="button" aria-label="Close" disabled={busy} onClick={onClose}><X size={18} /></button></Modal.Header>
    <Modal.Body>
      <p>{meetingId ? 'Anyone with this link can view the event title, description, schedule, and cancellation status without signing in. The attendee list and chat remain private.'
        : 'Subscribe in Google Calendar, Outlook, Apple Calendar, or another calendar app using this private iCal feed URL. It includes meetings you organize or are invited to, including cancellations.'}</p>
      <p>{meetingId ? 'Adding an event to another calendar creates a copy. That copy will not automatically update.'
        : 'This is read-only. Updates depend on your calendar app’s refresh schedule and may be delayed. Keep this URL private: anyone holding it can read your event details.'}</p>
      {loading && <p role="status">Loading sharing settings…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && <>
        <p>{token ? 'Sharing is enabled.' : 'Sharing is disabled.'}</p>
        {token && <><label>{meetingId ? 'Event link' : 'Subscription URL'}<input readOnly value={url} onFocus={event => event.target.select()} /></label>
          <div className="calendar-share-actions"><button type="button" onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              toast.success('Calendar link copied.');
            } catch {
              toast.error('Could not copy the link. Select it and copy manually.');
            }
          }}><Copy size={16} />Copy link</button>
          {meetingId && <a href={url} target="_blank" rel="noreferrer"><ExternalLink size={16} />Open event page</a>}</div>
        </>}
      </>}
    </Modal.Body>
    <Modal.Footer>
      {token ? <><button type="button" disabled={busy || loading || !!error} onClick={() => void change('regenerate')}><RefreshCw size={16} />Regenerate link</button><button type="button" disabled={busy || loading || !!error} onClick={() => void change('disable')}>Disable link</button></>
        : <button type="button" disabled={busy || loading || !!error} onClick={() => void change('enable')}><Link2 size={16} />{meetingId ? 'Enable event sharing' : 'Enable subscription'}</button>}
    </Modal.Footer>
  </Modal>;
}

export function CalendarFeedButton() {
  const [open, setOpen] = useState(false);
  return <><button className="calendar-feed-button" type="button" onClick={() => setOpen(true)}><Rss size={16} aria-hidden="true" /><span>Subscribe to calendar</span></button>
    {open && <CalendarLinkDialog onClose={() => setOpen(false)} />}</>;
}

export function MeetingCalendarActions({ id, canEdit }: { id: string; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const response = await authFetch(`${API_URL}/api/calendar/meetings/${id}/calendar.ics`);
      if (!response.ok) {
        throw new Error('Could not export this event. Check your access and try again.');
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'event.ics';
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'Export failed.');
    } finally {
      setBusy(false);
    }
  }
  return <div className="calendar-share-actions">
    <button type="button" disabled={busy} onClick={() => void download()}><Download size={16} />Download .ics</button>
    {canEdit && <button type="button" onClick={() => setOpen(true)}><CalendarPlus size={16} />Share event</button>}
    {open && <CalendarLinkDialog meetingId={id} onClose={() => setOpen(false)} />}
  </div>;
}
