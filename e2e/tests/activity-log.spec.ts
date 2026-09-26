import { test, expect } from '@playwright/test';
import { adminEmail, adminPassword, apiUrl, createUser, headersFor, login, tokenFor, userPassword } from './helpers.js';

test('records authentication and user events without credentials and restricts log access', async ({ request }) => {
  const user = await createUser(request, 'activity');
  const headers = { Authorization: `Bearer ${await tokenFor(request, adminEmail, adminPassword)}` };
  expect((await request.get(`${apiUrl}/api/activity-logs`)).status()).toBe(401);
  expect((await request.get(`${apiUrl}/api/activity-logs`, { headers: headersFor(user.username) })).status()).toBe(403);
  for (let i = 0; i < 5; i++) {
    expect((await request.post(`${apiUrl}/api/auth/login`, { data: { username: user.username, password: 'Never-Record-This!42' } })).status()).toBe(401);
  }
  const before = await request.get(`${apiUrl}/api/activity-logs?userId=${user.id}&pageSize=100`, { headers });
  expect(before.ok()).toBeTruthy();
  const entries = (await before.json()).items as { eventType: string; actorUserId: string | null; metadata: string }[];
  expect(entries.filter(x => x.eventType === 'UserLockedOut')).toHaveLength(1);
  expect(entries.filter(x => x.eventType === 'LoginFailed')).toHaveLength(5);
  expect(entries.map(x => x.eventType)).toEqual(expect.arrayContaining(['UserCreated', 'PasswordChanged', 'PasswordAuthenticationEnabled', 'LoginSucceeded']));
  expect(entries.find(x => x.eventType === 'LoginSucceeded')?.actorUserId).toBe(user.id);
  expect(JSON.stringify(entries)).not.toContain('Never-Record-This!42');
  expect(JSON.stringify(entries)).not.toContain(userPassword);
  expect((await request.put(`${apiUrl}/api/admin/users/${user.id}`, { headers, data: { email: user.username, isEnabled: true, roles: ['User', 'Global Admin'] } })).status()).toBe(204);
  for (const isEnabled of [false, true]) {
    expect((await request.patch(`${apiUrl}/api/admin/users/${user.id}/enabled`, { headers, data: { isEnabled } })).status()).toBe(204);
  }
  const users = await request.get(`${apiUrl}/api/activity-logs?userId=${user.id}&category=Users&pageSize=100`, { headers });
  const changes = (await users.json()).items as { eventType: string; actorUserId: string }[];
  expect(changes.map(x => x.eventType)).toEqual(expect.arrayContaining(['RolesChanged', 'AccountDisabled', 'AccountEnabled']));
  expect(changes.every(x => !x.eventType.startsWith('Login'))).toBeTruthy();
  expect(changes.find(x => x.eventType === 'RolesChanged')?.actorUserId).not.toBe(user.id);
  const filtered = await request.get(`${apiUrl}/api/activity-logs?userId=${user.id}&eventType=RolesChanged&pageSize=1`, { headers });
  expect((await filtered.json()).total).toBe(1);
  for (const query of ['category=Topics', 'page=0', 'pageSize=101', 'from=2026-09-27&to=2026-09-26']) {
    expect((await request.get(`${apiUrl}/api/activity-logs?${query}`, { headers })).status()).toBe(400);
  }
});

test('admin browses and filters activity while logout is recorded', async ({ page, request }) => {
  const user = await createUser(request, 'activity-ui');
  expect((await request.post(`${apiUrl}/api/auth/logout`, { headers: headersFor(user.username) })).status()).toBe(204);
  await login(page, adminEmail, adminPassword);
  await page.getByRole('button', { name: 'Activity log', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Activity log' })).toBeVisible();
  const eventFilter = page.getByRole('combobox', { name: 'Event', exact: true });
  await eventFilter.click();
  await expect(page.getByRole('group', { name: 'Authentication', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Users', exact: true })).toBeVisible();
  await eventFilter.fill('created');
  await expect(page.getByRole('option')).toHaveText(['User Created']);
  await page.getByRole('option', { name: 'User Created', exact: true }).click();
  await page.locator('.account-workspace').getByLabel('Search users').fill(user.id);
  const categoryFilter = page.getByRole('combobox', { name: 'Category', exact: true });
  await categoryFilter.fill('auth');
  await expect(page.getByRole('option')).toHaveText(['Authentication']);
  await categoryFilter.press('Enter');
  await expect(eventFilter).toHaveValue('All events');
  await eventFilter.click();
  await expect(page.getByRole('group', { name: 'Users', exact: true })).toHaveCount(0);
  await eventFilter.fill('nonexistent');
  await expect(page.getByText('No matches found.')).toBeVisible();
  await eventFilter.press('Escape');
  await expect(eventFilter).toHaveValue('All events');
  await eventFilter.fill('logged');
  await expect(page.getByRole('option')).toHaveText(['Logged Out']);
  await eventFilter.press('ArrowDown');
  await eventFilter.press('Enter');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.getByRole('cell', { name: 'Logged Out', exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('1 entries · Page 1 of 1', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('activity-log.png'), fullPage: true });
  await page.locator('.account-workspace').getByLabel('Search users').fill('no-such-activity-user');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.getByText('No activity found.')).toBeVisible();
});
