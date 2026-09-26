import { useState, type FormEvent, type ReactNode } from 'react';
import { MessageCircleMore } from 'lucide-react';
import { passwordLogin, type AccountUser } from '../services/auth';
import { startGoogleSignIn } from '../services/googleAuth';
import { microsoftEnabled, startMicrosoftSignIn, cancelPendingMicrosoftSignIn } from '../services/microsoftAuth';
import { ProviderLogo } from '../components/ProviderLogo';
import './accounts.css';

export function LoginPage({ onLogin, themeControl, initialError }: {
  onLogin: (user: AccountUser) => void; themeControl: ReactNode; initialError: string;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { onLogin(await passwordLogin(username.trim(), password)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not sign in.'); }
    finally { setBusy(false); }
  }
  async function external(provider: 'google' | 'microsoft') {
    setBusy(true); setError('');
    try { if (provider === 'google') { cancelPendingMicrosoftSignIn(); startGoogleSignIn(); } else await startMicrosoftSignIn(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not sign in.'); setBusy(false); }
  }
  return <main className="login-page">
    <section className="login-story" aria-label="Welcome to Huddle">
      <div className="brand"><MessageCircleMore size={32} /><strong>Huddle</strong></div>
      <div className="story-copy"><p className="eyebrow">A little closer. A lot more together.</p><h1>Your team.<br />One conversation.</h1><p>Connect with your team, share ideas, and keep your work together.</p></div><div className="login-story-note"><MessageCircleMore size={20} aria-hidden="true" /><span>A space for the people you work with.</span></div>
    </section>
    <section className="login-panel">{themeControl}<form className="login-card account-form" onSubmit={submit}>
      <div className="login-heading"><span className="eyebrow">Welcome back</span><h2>Sign in to Huddle</h2><p>Pick up where your team left off.</p></div>
      {import.meta.env.VITE_GOOGLE_CLIENT_ID && <button type="button" className="secondary-button" disabled={busy} onClick={() => void external('google')}><ProviderLogo provider="google" />Continue with Google</button>}
      {microsoftEnabled && <button type="button" className="secondary-button" disabled={busy} onClick={() => void external('microsoft')}><ProviderLogo provider="microsoft" />Continue with Microsoft</button>}
      {(import.meta.env.VITE_GOOGLE_CLIENT_ID || microsoftEnabled) && <div className="login-divider"><span>or use your password</span></div>}
      <label>Email or username<input placeholder="you@example.com" autoComplete="username" required maxLength={256} value={username} onChange={e => setUsername(e.target.value)} /></label>
      <label>Password<input placeholder="Enter your password" type="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={e => setPassword(e.target.value)} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
      <p className="login-note">Password access is managed by your administrator.</p>
    </form></section>
  </main>;
}
