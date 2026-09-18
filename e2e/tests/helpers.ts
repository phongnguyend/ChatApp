import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const apiUrl = process.env.E2E_API_URL ?? 'http://localhost:5046';

export function uniqueName(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function createUser(request: APIRequestContext, prefix: string) {
  const name = uniqueName(prefix);
  const response = await request.post(`${apiUrl}/api/session`, { data: { username: name } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return await response.json() as { id: string; username: string; displayName: string };
}

export async function login(page: Page, username: string) {
  await page.goto('/');
  await page.getByLabel('Your name').fill(username);
  await page.getByRole('button', { name: 'Enter Huddle' }).click();
  await expect(page.getByRole('navigation', { name: 'Main sections' })).toBeVisible();
}

export async function openSection(page: Page, section: string) {
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: new RegExp(`^${section}(?:[,\\s]|$)`) }).click();
  await expect(page.getByRole('heading', { name: section, exact: true })).toBeVisible();
}

export async function apiPost<T>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await request.post(`${apiUrl}${path}`, { data });
  expect(response.ok(), await response.text()).toBeTruthy();
  return await response.json() as T;
}
