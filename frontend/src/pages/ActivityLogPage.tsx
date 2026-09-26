import { useEffect, useState, type FormEvent } from 'react';
import { accountApi } from '../services/auth';
import { RefreshCw, Filter } from 'lucide-react';
import { AccountHeader } from '../components/AccountHeader';
import { SearchableSelect } from '../components/SearchableSelect';
import './accounts.css';

const categories: Record<string, string[]> = {
  Authentication: ['LoginSucceeded', 'LoginFailed', 'UserLockedOut', 'LoggedOut'],
  Users: ['UserCreated', 'UserUpdated', 'RolesChanged', 'ExternalLoginLinked', 'PasswordChanged', 'AccountEnabled', 'AccountDisabled', 'PasswordAuthenticationEnabled', 'PasswordAuthenticationDisabled'],
};
const label = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2');
function localTimeWithOffset(value: string) {
  const date = new Date(value);
  const offset = -date.getTimezoneOffset();
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
  const minutes = String(Math.abs(offset) % 60).padStart(2, '0');
  return `${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} ${offset >= 0 ? '+' : '-'}${hours}:${minutes}`;
}
type Entry = { id: string; occurredAt: string; eventType: string; entityName: string | null; entityId: string | null; actorUsername: string | null; actorUserId: string | null; metadata: string };
type Result = { items: Entry[]; total: number };

export function ActivityLogPage({ onBack }: { onBack: () => void }) {
  const [result, setResult] = useState<Result>({ items: [], total: 0 });
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('');
  const [eventType, setEventType] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filters, setFilters] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rangeError, setRangeError] = useState('');
  useEffect(() => {
    let active = true;
    const query = new URLSearchParams(filters);
    query.set('page', String(page)); query.set('pageSize', '25');
    Promise.resolve().then(() => { if (active) { setLoading(true); setError(''); } });
    accountApi<Result>(`/api/activity-logs?${query}`)
      .then(value => { if (active) setResult(value); })
      .catch((failure: Error) => { if (active) setError(failure.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, filters, refresh]);
  function apply(event: FormEvent) {
    event.preventDefault();
    if (from && to && new Date(from) > new Date(to)) { setRangeError('From must be earlier than or equal to To.'); return; }
    setRangeError('');
    const query = new URLSearchParams({ category, eventType, search: search.trim() });
    if (from) query.set('from', new Date(from).toISOString());
    if (to) query.set('to', new Date(to).toISOString());
    setFilters(query.toString()); setPage(1); setRefresh(value => value + 1);
  }
  return <section className="account-workspace account-table-page">
    <AccountHeader title="Activity log" description="A history of sign-ins and changes to user access." eyebrow="Workspace activity" onBack={onBack} actions={<button className="secondary-button" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={15} aria-hidden="true" />Refresh</button>} />
    <form className="account-form activity-filters" onSubmit={apply}>
      <SearchableSelect label="Category" value={category} onChange={value => { setCategory(value); setEventType(''); }} options={[{ value: '', label: 'All categories' }, ...Object.keys(categories).map(value => ({ value, label: value }))]} />
      <SearchableSelect key={category} label="Event" value={eventType} onChange={setEventType} options={[{ value: '', label: 'All events' }, ...Object.entries(categories).filter(([name]) => !category || name === category).flatMap(([group, events]) => events.map(value => ({ value, label: label(value), group })))]} />
      <label>Search users<input value={search} maxLength={256} onChange={e => setSearch(e.target.value)} placeholder="Username or user ID" /></label>
      <label>From (local time)<input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label>To (local time)<input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} /></label>
      <button className="primary-button" type="submit"><Filter size={14} aria-hidden="true" />Apply filters</button>
    </form>
    {(error || rangeError) && <p role="alert">{rangeError || error}</p>}
    {loading ? <p role="status">Loading activity…</p> : !error && <>
      <div className="account-table-wrap"><table><thead><tr><th>Time</th><th>Event</th><th>User</th><th>Performed by</th><th>Details</th></tr></thead><tbody>{result.items.map(item => <tr key={item.id}>
        <td><time className="activity-time" dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}<small>{localTimeWithOffset(item.occurredAt)}</small></time></td><td><span className={`account-badge ${/Failed|LockedOut|Disabled/.test(item.eventType) ? 'attention' : /Succeeded|Enabled/.test(item.eventType) ? 'positive' : ''}`}>{label(item.eventType)}</span></td><td><span className="activity-person" title={item.entityId || undefined}>{item.entityName || 'Unknown user'}</span></td><td><span className="activity-person" title={item.actorUserId || undefined}>{item.actorUsername || 'Unauthenticated / system'}</span></td><td><details><summary>Details</summary><div className="activity-metadata"><p>User ID: {item.entityId || 'Unknown'}</p><p>Actor ID: {item.actorUserId || 'Unauthenticated / system'}</p>{item.metadata !== '{}' && <pre>{JSON.stringify(JSON.parse(item.metadata), null, 2)}</pre>}</div></details></td>
      </tr>)}{!result.items.length && <tr><td colSpan={5}>No activity found.</td></tr>}</tbody></table></div>
      <div className="activity-pagination"><span>{result.total} entries · Page {page} of {Math.max(1, Math.ceil(result.total / 25))}</span><button className="secondary-button" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button><button className="secondary-button" disabled={page * 25 >= result.total} onClick={() => setPage(value => value + 1)}>Next</button></div>
    </>}
  </section>;
}
