import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const apiUrl = process.env.E2E_API_URL ?? 'http://localhost:5046';
export const adminEmail = 'admin@chatapp-e2e.test';
export const adminPassword = 'E2e-Only-Admin-Password!42';
export const userPassword = 'E2e-Only-User-Password!42';
const accounts = new Map<string, { email: string; token: string }>();

export async function tokenFor(request: APIRequestContext, username: string, password = userPassword) {
  const response = await request.post(`${apiUrl}/api/auth/login`, { data: { username, password } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).accessToken as string;
}

export function headersFor(username: string) {
  const account = accounts.get(username);
  if (!account) throw new Error(`No test credentials for ${username}`);
  return { Authorization: `Bearer ${account.token}` };
}

export function uniqueName(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function createUser(request: APIRequestContext, prefix: string) {
  const email = `${uniqueName(prefix).slice(0, 35)}@e2e.test`;
  const adminToken = await tokenFor(request, adminEmail, adminPassword);
  const headers = { Authorization: `Bearer ${adminToken}` };
  const created = await request.post(`${apiUrl}/api/admin/users`, { headers, data: { email, isEnabled: true, roles: ['User'] } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { id } = await created.json();
  const configured = await request.put(`${apiUrl}/api/admin/users/${id}/password-authentication`, { headers, data: { allowPasswordAuthentication: true, password: userPassword } });
  expect(configured.ok(), await configured.text()).toBeTruthy();
  const token = await tokenFor(request, email);
  const response = await request.post(`${apiUrl}/api/session`, { headers: { Authorization: `Bearer ${token}` } });
  expect(response.ok(), await response.text()).toBeTruthy();
  const user = await response.json() as { id: string; username: string; displayName: string };
  accounts.set(user.username, { email, token });
  return user;
}

export async function login(page: Page, username: string, password = userPassword) {
  await page.goto('/');
  await page.getByLabel('Email or username').fill(accounts.get(username)?.email ?? username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Main sections' })).toBeVisible();
}

export async function openSection(page: Page, section: string) {
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: new RegExp(`^${section}(?:[,\\s]|$)`) }).click();
  await expect(page.getByRole('heading', { name: section, exact: true })).toBeVisible();
}

export async function apiPost<T>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const username = new URL(path, apiUrl).searchParams.get('username')!;
  const response = await request.post(`${apiUrl}${path}`, { data, headers: headersFor(username) });
  expect(response.ok(), await response.text()).toBeTruthy();
  return await response.json() as T;
}
