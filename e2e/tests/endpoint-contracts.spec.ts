import { expect, test } from '@playwright/test';
import { apiUrl, createUser, headersFor } from './helpers.js';

test('endpoint migration preserves validation, locations, caching and access boundaries', async ({ request }) => {
  const user = await createUser(request, 'endpoint-contract');
  const headers = headersFor(user.username);
  const query = `username=${encodeURIComponent(user.username)}`;

  for (const data of [{}, { title: null }]) {
    const invalid = await request.post(`${apiUrl}/api/user-tasks?${query}`, { headers, data });
    expect(invalid.status(), await invalid.text()).toBe(400);
    expect((await invalid.json()).errors).toHaveProperty('Title');
  }
  const invalidJson = await request.post(`${apiUrl}/api/user-tasks?${query}`, {
    headers: { ...headers, 'Content-Type': 'application/json' }, data: '{',
  });
  expect(invalidJson.status()).toBe(400);
  expect((await request.get(`${apiUrl}/api/user-tasks`, { headers })).status()).toBe(400);
  expect((await request.get(`${apiUrl}/api/user-tasks?${query}&from=not-a-date`, { headers })).status()).toBe(400);
  expect((await request.get(`${apiUrl}/api/users?currentUsername=somebody-else`, { headers })).status()).toBe(403);
  expect((await request.get(`${apiUrl}/api/documents/storage-management?${query}`, { headers })).status()).toBe(403);

  const created = await request.post(`${apiUrl}/api/user-tasks?${query}`, {
    headers, data: { title: 'Endpoint contract task', priority: 'normal' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const location = new URL(created.headers().location, apiUrl);
  expect(location.pathname).toBe('/api/user-tasks');
  expect(location.searchParams.get('username')).toBe(user.username);
  expect((await request.get(location.href, { headers })).status()).toBe(200);

  const notifications = await request.get(`${apiUrl}/api/user-notifications/unread-count?${query}`, { headers });
  expect(notifications.status()).toBe(200);
  expect(notifications.headers()['cache-control']).toContain('no-store');
  const conversations = await (await request.get(`${apiUrl}/api/conversations?${query}`, { headers })).json();
  const recordings = await request.get(`${apiUrl}/api/recordings/conversation/${conversations[0].id}?${query}`, { headers });
  expect(recordings.status(), await recordings.text()).toBe(200);
  expect(await recordings.json()).toEqual([]);

  // Anonymous routes must still execute their handler instead of returning 401.
  expect((await request.get(`${apiUrl}/uploads/avatars/missing.png`)).status()).toBe(404);
  expect((await request.get(`${apiUrl}/api/documents/public/missing-token`)).status()).toBe(404);
});

test('avatar endpoint enforces its request limit before reading multipart content', async ({ request }) => {
  const user = await createUser(request, 'endpoint-upload');
  const response = await request.post(`${apiUrl}/api/users/avatar?username=${encodeURIComponent(user.username)}`, {
    headers: headersFor(user.username),
    multipart: { image: { name: 'oversize.png', mimeType: 'image/png', buffer: Buffer.alloc(6 * 1024 * 1024 + 1) } },
  });
  expect(response.status(), await response.text()).toBe(413);
});
