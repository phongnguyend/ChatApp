import { useState, type FormEvent } from 'react';
import { accountApi, clearSession, loadProfile, type AccountUser } from '../services/auth';
import { microsoftEnabled, startMicrosoftSignIn } from '../services/microsoftAuth';
import { UserRound, ShieldCheck, Link } from 'lucide-react';
import { AccountHeader } from '../components/AccountHeader';
import { ProviderLogo } from '../components/ProviderLogo';
import './accounts.css';

export function AccountPage({ user, onBack, onSaved }: { user: AccountUser; onBack: () => void; onSaved: (user: AccountUser) => void }) {
  const [firstName, setFirstName] = useState(user.firstName ?? '');
  const [lastName, setLastName] = useState(user.lastName ?? '');
  const [phoneNumber, setPhoneNumber] = useState(user.phoneNumber ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function save(event: FormEvent, password = false) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await accountApi(`/api/auth/me${password ? '/password' : ''}`, { method: 'PUT', body: JSON.stringify(password ? { currentPassword, newPassword } : { firstName, lastName, phoneNumber }) });
      if (password) clearSession();
      else { onSaved(await loadProfile(false)); setNotice('Profile saved.'); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save your account.'); }
    finally { setBusy(false); }
  }
  return <section className="account-workspace"><AccountHeader title="Account settings" description="Your profile, connected accounts, and sign-in security." eyebrow="Your account" onBack={onBack} />
    <div className="profile-settings">
    <div className="account-identity"><span className="account-avatar">{(user.firstName || user.username).slice(0, 1).toUpperCase()}</span><div><strong>{[user.firstName, user.lastName].filter(Boolean).join(' ') || user.username}</strong><p>{user.email || user.username}</p></div><div className="account-badges">{user.roles.map(role => <span className="account-badge" key={role}>{role}</span>)}</div></div>
    {error && <p role="alert" className="form-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <section className="profile-settings-section"><div className="profile-section-heading"><UserRound size={19} aria-hidden="true" /><div><h2>Personal details</h2><p>Your name and contact information.</p></div></div>
    <form className="account-form" onSubmit={e => void save(e)}>
      <div className="profile-name-fields"><label>First name<input autoComplete="given-name" maxLength={100} value={firstName} onChange={e => setFirstName(e.target.value)} /></label>
      <label>Last name<input autoComplete="family-name" maxLength={100} value={lastName} onChange={e => setLastName(e.target.value)} /></label></div>
      <label>Phone<input type="tel" autoComplete="tel" maxLength={50} value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} /></label>
      <div className="profile-section-actions"><button className="primary-button" disabled={busy}>Save profile</button></div>
    </form></section>
    {microsoftEnabled && <section className="profile-settings-section"><div className="profile-section-heading"><Link size={19} aria-hidden="true" /><div><h2>Connected accounts</h2><p>Connect another way to sign in.</p></div></div><div className="profile-provider"><div><strong>Microsoft</strong><p>Use your Microsoft account with Huddle.</p></div><button type="button" className="secondary-button" disabled={busy} onClick={() => void startMicrosoftSignIn(user.id).catch(e => setError(e.message))}><ProviderLogo provider="microsoft" />Connect Microsoft account</button></div></section>}
    <section className="profile-settings-section"><div className="profile-section-heading"><ShieldCheck size={19} aria-hidden="true" /><div><h2>Password security</h2><p>Manage your password sign-in.</p></div></div>
    {user.allowPasswordAuthentication ? <form className="account-form" onSubmit={e => void save(e, true)}>
      {user.hasPassword && <label>Current password<input type="password" autoComplete="current-password" required maxLength={1024} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></label>}
      <label>New password<input type="password" autoComplete="new-password" required minLength={12} maxLength={1024} value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label>
      <p>Use at least 12 characters with uppercase, lowercase, a number, and a symbol. You will need to sign in again.</p>
      <div className="profile-section-actions"><button className="primary-button" disabled={busy}>Change password</button></div>
    </form> : <div className="profile-security-info"><span className="account-badge muted">Password sign-in disabled</span><p>Contact an administrator to enable password authentication.</p></div>}</section>
    </div>
  </section>;
}
