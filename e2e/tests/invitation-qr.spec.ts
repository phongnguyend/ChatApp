import { expect, test } from '@playwright/test';
import { apiPost, createUser, login, uniqueName } from './helpers.js';

test('invitation QR loads with authentication and can retry a failure', async ({ page, request }) => {
  const owner = await createUser(request, 'qr-owner');
  const member = await createUser(request, 'qr-member');
  const title = uniqueName('QR group');
  await apiPost(request, `/api/conversations?username=${encodeURIComponent(owner.username)}`, { title, usernames: [member.username] });
  await login(page, owner.username);
  await page.locator('.conversation-item').filter({ hasText: title }).click();
  let fail = true;
  await page.route('**/join-qr-code?*', async route => {
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    if (fail) await route.fulfill({ status: 503, body: 'Unavailable' });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Show conversation join link' }).click();
  const dialog = page.getByRole('dialog', { name: 'Join this conversation' });
  await expect(dialog.getByRole('alert')).toContainText('Could not load the QR code');
  await expect(dialog.getByRole('button', { name: 'Copy link' })).toBeVisible();
  fail = false;
  await dialog.getByRole('button', { name: 'Retry QR code' }).click();
  const qr = dialog.getByRole('img', { name: `QR code to join ${title}` });
  await expect(qr).toBeVisible();
  await expect(qr).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => qr.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
});
