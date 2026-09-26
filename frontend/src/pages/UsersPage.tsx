import { useEffect, useState, type FormEvent } from 'react';
import { accountApi, type AccountUser } from '../services/auth';
import { Plus, KeyRound, Eye, Pencil, UserRound, ShieldCheck, UserX, UserCheck } from 'lucide-react';
import { UserActions } from '../components/UserActions';
import { AccountHeader } from '../components/AccountHeader';
import { AccountDialogHeader } from '../components/AccountDialogHeader';
import './accounts.css';

type ManagedUser = AccountUser & { lockoutEnabled: boolean; lockoutEnd: string | null; accessFailedCount: number };
type Editor = { id?: string; email: string; firstName: string; lastName: string; phoneNumber: string; isEnabled: boolean; roles: string[]; existingEmail?: boolean };
const emptyUser: Editor = { email: '', firstName: '', lastName: '', phoneNumber: '', isEnabled: true, roles: ['User'] };

export function UsersPage({ currentUser, onBack }: { currentUser: AccountUser; onBack: () => void }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [passwordUser, setPasswordUser] = useState<ManagedUser | null>(null);
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [password, setPassword] = useState('');
  const [selected, setSelected] = useState<ManagedUser | null>(null);
  const [toggleUser, setToggleUser] = useState<ManagedUser | null>(null);
  const [now, setNow] = useState(Date.now());
  const load = async () => setUsers(await accountApi<ManagedUser[]>('/api/admin/users'));
  useEffect(() => { load().catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  async function save(event: FormEvent) {
    event.preventDefault(); if (!editor) return;
    await perform(async () => {
      await accountApi(`/api/admin/users${editor.id ? `/${editor.id}` : ''}`, { method: editor.id ? 'PUT' : 'POST', body: JSON.stringify(editor) });
      setEditor(null);
    });
  }
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); await load(); setNotice('User saved.'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save the user.'); }
    finally { setBusy(false); }
  }
  const filtered = users.filter(u => [u.username, u.email, u.firstName, u.lastName, u.phoneNumber, ...u.roles].some(v => v?.toLowerCase().includes(query.trim().toLowerCase())));
  const locked = (u: ManagedUser) => u.lockoutEnabled && u.lockoutEnd && Date.parse(u.lockoutEnd) > now;
  const close = () => { if (!busy) { setEditor(null); setPasswordUser(null); setSelected(null); setToggleUser(null); setPassword(''); setError(''); } };
  return <section className="account-workspace account-table-page">
    <AccountHeader title="Users" description="Manage your people and their access to Huddle." eyebrow="Workspace access" onBack={onBack} actions={<button className="primary-button" onClick={() => { setError(''); setEditor({ ...emptyUser }); }}><Plus size={16} aria-hidden="true" />Create user</button>} />
    <div className="account-summary"><span><strong>{users.length}</strong> people</span><span><i className="status-dot" /><strong>{users.filter(u => u.isEnabled).length}</strong> enabled</span><span><strong>{users.filter(u => u.roles.includes('Global Admin')).length}</strong> administrators</span></div>
    <label className="account-search">Search users<input placeholder="Name, email, phone, or role" value={query} onChange={e => setQuery(e.target.value)} /></label>
    {error && !(editor || passwordUser || toggleUser) && <p role="alert" className="form-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {loading ? <p role="status">Loading users...</p> : <div className="account-table-wrap"><table><thead><tr><th>Name / email</th><th>Roles</th><th>Status</th><th>Password access</th><th>Lockout</th><th>Actions</th></tr></thead><tbody>
      {filtered.map(u => <tr key={u.id}><td><strong>{[u.firstName, u.lastName].filter(Boolean).join(' ') || u.username}</strong>{u.id === currentUser.id && ' (you)'}<small>{u.email || 'Email not assigned'}</small></td><td><div className="account-badges">{u.roles.map(role => <span key={role} className={`account-badge ${role === 'Global Admin' ? 'admin' : ''}`}>{role}</span>)}</div></td><td><span className={`account-badge ${u.isEnabled ? 'positive' : 'muted'}`}>{u.isEnabled ? 'Enabled' : 'Disabled'}</span></td><td>{u.allowPasswordAuthentication ? 'Enabled' : 'Disabled'}</td><td>{locked(u) ? `Locked until ${new Date(u.lockoutEnd!).toLocaleString()}` : 'Not locked'}<small>Failed attempts: {u.accessFailedCount}</small></td><td className="user-actions-cell"><UserActions username={u.username}>
        <button className="secondary-button" onClick={() => setSelected(u)}><Eye size={14} aria-hidden="true" />View</button>
        <button className="secondary-button" disabled={busy} onClick={() => { setError(''); setEditor({ id: u.id, email: u.email ?? '', firstName: u.firstName ?? '', lastName: u.lastName ?? '', phoneNumber: u.phoneNumber ?? '', isEnabled: u.isEnabled, roles: [...u.roles], existingEmail: !!u.email }); }}><Pencil size={14} aria-hidden="true" />Edit</button>
        <button className="secondary-button" disabled={busy} onClick={() => { setError(''); setPasswordUser(u); setPasswordEnabled(u.allowPasswordAuthentication); setPassword(''); }} aria-label="Password authentication"><KeyRound size={14} aria-hidden="true" />Password settings</button>
        <button className={`secondary-button ${u.isEnabled ? "user-action-danger" : ""}`} disabled={busy || u.id === currentUser.id} onClick={() => { setError(''); setToggleUser(u); }}>{u.isEnabled ? <UserX size={14} aria-hidden="true" /> : <UserCheck size={14} aria-hidden="true" />}{u.isEnabled ? 'Disable' : 'Enable'}</button>
      </UserActions></td></tr>)}
      {!filtered.length && <tr><td colSpan={6}>No users found.</td></tr>}
    </tbody></table></div>}
    {(editor || passwordUser || selected || toggleUser) && <div className="account-dialog-backdrop"><section className="account-dialog" role="dialog" aria-modal="true" aria-label={editor ? editor.id ? 'Edit user' : 'Create user' : passwordUser ? 'Password authentication' : toggleUser ? 'Confirm account status' : 'User details'}>
      <AccountDialogHeader title={editor ? editor.id ? 'Edit user' : 'Create user' : passwordUser ? 'Password authentication' : toggleUser ? `${toggleUser.isEnabled ? 'Disable' : 'Enable'} user?` : 'User details'} description={editor ? editor.id ? 'Update profile details and workspace access.' : 'Add someone to your workspace.' : (passwordUser || toggleUser || selected)!.email || (passwordUser || toggleUser || selected)!.username} icon={passwordUser ? <KeyRound size={21} /> : toggleUser ? <ShieldCheck size={21} /> : <UserRound size={21} />} busy={busy} onClose={close} />
      {error && <p role="alert" className="form-error account-dialog-error">{error}</p>}
      {editor && <form className="account-form user-editor" onSubmit={save}>
        <div className="user-editor-fields">
        <label>Email<input type="email" required maxLength={256} disabled={editor.existingEmail} value={editor.email} onChange={e => setEditor({ ...editor, email: e.target.value })} /></label>
        <div className="user-editor-names"><label>First name<input maxLength={100} value={editor.firstName} onChange={e => setEditor({ ...editor, firstName: e.target.value })} /></label>
        <label>Last name<input maxLength={100} value={editor.lastName} onChange={e => setEditor({ ...editor, lastName: e.target.value })} /></label></div>
        <label>Phone<input maxLength={50} value={editor.phoneNumber} onChange={e => setEditor({ ...editor, phoneNumber: e.target.value })} /></label>
        <fieldset className="user-editor-roles"><legend>Workspace roles</legend>{['User', 'Global Admin'].map(role => <label className="account-check user-role-choice" key={role}><input type="checkbox" aria-label={role} checked={editor.roles.includes(role)} disabled={editor.id === currentUser.id && role === 'Global Admin'} onChange={e => setEditor({ ...editor, roles: e.target.checked ? [...editor.roles, role] : editor.roles.filter(r => r !== role) })} /><span><strong>{role}</strong><small>{role === 'User' ? 'Use workspace features' : 'Manage users and access'}</small></span>{role === 'Global Admin' && <ShieldCheck size={17} aria-hidden="true" />}</label>)}</fieldset>
        <label className="account-check user-editor-status"><span><strong>Account enabled</strong><small>Allow this user to sign in.</small></span><input type="checkbox" aria-label="Account enabled" checked={editor.isEnabled} disabled={editor.id === currentUser.id} onChange={e => setEditor({ ...editor, isEnabled: e.target.checked })} /></label>
        </div>
        <footer className="user-editor-footer"><button type="button" className="secondary-button" disabled={busy} onClick={close}>Cancel</button><button className="primary-button" disabled={busy || !editor.roles.length}>{busy ? 'Saving...' : 'Save user'}</button></footer>
      </form>}
      {passwordUser && <form className="account-form user-editor" onSubmit={e => { e.preventDefault(); void perform(async () => { await accountApi(`/api/admin/users/${passwordUser.id}/password-authentication`, { method: 'PUT', body: JSON.stringify({ allowPasswordAuthentication: passwordEnabled, password: password || undefined }) }); setPasswordUser(null); setPassword(''); }); }}>
        <div className="user-editor-fields">
        <label className="account-check user-editor-status password-access-toggle"><span><strong>Allow password authentication</strong><small>Let this user sign in with a password.</small></span><input type="checkbox" aria-label="Allow password authentication" checked={passwordEnabled} onChange={e => setPasswordEnabled(e.target.checked)} /></label>
        <label>New password<input type="password" autoComplete="new-password" disabled={!passwordEnabled} required={passwordEnabled && !passwordUser.hasPassword} minLength={12} maxLength={1024} value={password} onChange={e => setPassword(e.target.value)} /></label>
        <p>Use at least 12 characters, with uppercase, lowercase, a number, and a symbol. Password changes sign out existing sessions.</p>
        </div>
        <footer className="user-editor-footer"><button type="button" className="secondary-button" disabled={busy} onClick={close}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Saving...' : 'Save password settings'}</button></footer>
      </form>}
      {toggleUser && <><div className="user-editor-fields"><p>{toggleUser.isEnabled ? 'This user will lose access to Huddle.' : 'This user will regain access to Huddle.'}</p></div><footer className="user-editor-footer"><button type="button" className="secondary-button" disabled={busy} onClick={close}>Cancel</button><button className="primary-button" disabled={busy} onClick={() => void perform(async () => { await accountApi(`/api/admin/users/${toggleUser.id}/enabled`, { method: 'PATCH', body: JSON.stringify({ isEnabled: !toggleUser.isEnabled }) }); setToggleUser(null); })}>Confirm</button></footer></>}
      {selected && <><div className="user-editor-fields"><dl>{Object.entries({ Username: selected.username, Email: selected.email || 'Not assigned', Name: [selected.firstName, selected.lastName].filter(Boolean).join(' ') || 'Not provided', Phone: selected.phoneNumber || 'Not provided', Roles: selected.roles.join(', ') || 'No roles assigned', Status: selected.isEnabled ? 'Enabled' : 'Disabled', 'Password authentication': selected.allowPasswordAuthentication ? 'Enabled' : 'Disabled', 'External login': selected.hasExternalLogin ? 'Connected' : 'Not connected', 'Failed attempts': selected.accessFailedCount, Lockout: locked(selected) ? new Date(selected.lockoutEnd!).toLocaleString() : 'Not locked' }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div><footer className="user-editor-footer"><button type="button" className="secondary-button" onClick={close}>Done</button></footer></>}
    </section></div>}
  </section>;
}
