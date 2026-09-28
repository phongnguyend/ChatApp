import { expect, test, type Page } from '@playwright/test';
import { apiPost, createUser, login, uniqueName } from './helpers.js';

async function copyImage(page: Page) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 20;
    canvas.height = 20;
    canvas.getContext('2d')!.fillRect(0, 0, 20, 20);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  });
}

test('pasted profile photo waits for Save and supports cancel and size validation', async ({ page, request }) => {
  const user = await createUser(request, 'paste-profile');
  await login(page, user.username);
  await page.getByRole('button', { name: 'Edit your profile' }).click();
  const preview = page.getByRole('group', { name: 'Your profile photo preview' });
  let uploads = 0;
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/api/users/avatar')) {
      uploads++;
    }
  });
  await copyImage(page);
  await preview.click();
  await preview.press('Control+V');
  await expect(preview.locator('img')).toHaveAttribute('src', /^blob:/);
  await expect(page.getByRole('button', { name: 'Save photo', exact: true })).toBeVisible();
  expect(uploads).toBe(0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(preview.locator('img')).toHaveCount(0);
  await page.evaluate(async () => navigator.clipboard.writeText('No image'));
  await page.getByRole('button', { name: 'Paste image', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No image found in the clipboard.');
  await copyImage(page);
  await page.getByRole('button', { name: 'Paste image', exact: true }).click();
  await expect(preview.locator('img')).toHaveAttribute('src', /^blob:/);
  await preview.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole('alert')).toContainText('Choose an image smaller than 5 MB.');
  await expect(preview.locator('img')).toHaveAttribute('src', /^blob:/);
  expect(uploads).toBe(0);
  await page.getByRole('button', { name: 'Save photo', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Profile photo updated.');
  expect(uploads).toBe(1);
  await page.reload();
  await expect(page.locator('.layout-user img')).toBeVisible();
});

test('pasted group avatar uploads through the existing group editor', async ({ page, request }) => {
  const owner = await createUser(request, 'paste-group');
  const member = await createUser(request, 'paste-member');
  const title = uniqueName('Avatar group');
  await apiPost(request, `/api/conversations?username=${encodeURIComponent(owner.username)}`, { title, usernames: [member.username] });
  await login(page, owner.username);
  await page.locator('.conversation-item').filter({ hasText: title }).click();
  await page.getByRole('button', { name: "Update this group's avatar" }).click();
  await copyImage(page);
  const preview = page.getByRole('group', { name: `${title} preview` });
  const upload = page.waitForResponse((response) => response.url().includes('/avatar?') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Paste image', exact: true }).click();
  const response = await upload;
  expect(response.ok(), await response.text()).toBeTruthy();
  const avatarUrl = new URL((await response.json()).avatarUrl, response.url()).href;
  await expect(preview.locator('img')).toHaveAttribute('src', avatarUrl);
  await expect.poll(() => preview.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('.pending-attachment')).toHaveCount(0);
  await page.locator('.avatar-dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await page.locator('.conversation-item').filter({ hasText: title }).click();
  await expect(page.getByRole('button', { name: "Update this group's avatar" }).locator('img')).toHaveAttribute('src', avatarUrl);
});
