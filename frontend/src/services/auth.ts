import { completeGoogleSignIn } from './googleAuth';
import { completeMicrosoftSignIn } from './microsoftAuth';

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:5045';
export const TOKEN_KEY = 'chatapp-access-token';
export type AccountUser = {
  id: string; username: string; displayName: string; avatarUrl: string | null;
  email: string | null; firstName: string | null; lastName: string | null;
  phoneNumber: string | null; isEnabled: boolean; roles: string[];
  allowPasswordAuthentication: boolean; hasPassword: boolean; hasExternalLogin: boolean;
};
export const getAccessToken = () => sessionStorage.getItem(TOKEN_KEY) ?? '';
export function clearSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event('chatapp-auth-expired'));
}

export async function authFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
  const api = new URL(API_URL, window.location.href);
  if (url.origin !== api.origin || !url.pathname.startsWith('/api/')) return window.fetch(input, init);
  const token = getAccessToken();
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  const response = await window.fetch(input, { ...init, headers, credentials: 'include' });
  if (response.status === 401 && token && !url.pathname.endsWith('/auth/login')) clearSession();
  // Never render server diagnostics, request headers, or upstream response bodies.
  if (response.status >= 500) {
    const message = 'The service is temporarily unavailable. Please try again shortly.';
    return new Response(JSON.stringify({ error: message, message, detail: message }), {
      status: response.status, headers: { 'Content-Type': 'application/problem+json' },
    });
  }
  return response;
}

export async function accountApi<T = void>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await authFetch(`${API_URL}${path}`, { ...init, headers });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    throw new Error(problem.error || problem.message || problem.detail || `Request failed (${response.status}).`);
  }
  return response.status === 204 ? undefined as T : response.json();
}

export async function loadProfile(initialize = true) {
  if (initialize) await accountApi('/api/session', { method: 'POST' });
  return accountApi<AccountUser>('/api/auth/me');
}

export async function passwordLogin(username: string, password: string) {
  const session = await accountApi<{ accessToken: string }>('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ username, password }),
  });
  sessionStorage.setItem(TOKEN_KEY, session.accessToken);
  return loadProfile();
}

export async function logout() {
  try { await accountApi('/api/auth/logout', { method: 'POST' }); }
  finally { clearSession(); }
}

// A single redirect exchange also avoids duplicate requests under React StrictMode.
export const initialSession = (async () =>
  await completeMicrosoftSignIn(TOKEN_KEY) ?? await completeGoogleSignIn(TOKEN_KEY))();
