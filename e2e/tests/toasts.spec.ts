import { expect, test } from '@playwright/test';
import { createUser, login, openSection } from './helpers.js';

test('Shared toasts pause timers, deduplicate, stay above modals, and retain errors', async ({ page, request }) => {
  const user = await createUser(request, 'toasts');
  await login(page, user.username);
  await openSection(page, 'My Documents');
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New folder', exact: true });
  await page.clock.install();
  await page.evaluate(async () => {
    const modulePath = '/src/services/toasts.ts';
    const { toast } = await import(modulePath);
    toast.success('Shared notification');
    toast.success('Shared notification');
  });
  const toastItem = dialog.locator('.app-toast').filter({ hasText: 'Shared notification' });
  await expect(toastItem).toHaveCount(1);
  await expect(toastItem.getByRole('status')).toBeVisible();
  await expect(toastItem.locator('.app-toast-icon')).toHaveCSS('flex-shrink', '0');
  await toastItem.hover();
  await page.clock.fastForward(10000);
  await expect(toastItem).toBeVisible();
  await toastItem.getByRole('button', { name: 'Dismiss notification' }).focus();
  await page.mouse.move(1, 1);
  await page.clock.fastForward(10000);
  await expect(toastItem).toBeVisible();
  await dialog.getByLabel('Name', { exact: true }).focus();
  await page.clock.fastForward(6500);
  await expect(toastItem).toHaveCount(0);

  await page.evaluate(async () => {
    const modulePath = '/src/services/toasts.ts';
    const { toast } = await import(modulePath);
    toast.error('Upload failed. Please try again.');
    toast.warning('Your storage is almost full.');
    toast.info('A new version is available.');
    toast.success('Changes saved.');
  });
  await expect(dialog.locator('.app-toast')).toHaveCount(4);
  await page.screenshot({ path: 'test-results/toasts-light-modal.png', animations: 'disabled' });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/toasts-dark-mobile.png', animations: 'disabled' });
  const bounds = await dialog.locator('.app-toast-viewport').boundingBox();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
  await page.clock.fastForward(20000);
  await expect(dialog.locator('.app-toast')).toHaveCount(1);
  await expect(dialog.getByRole('alert')).toHaveText('Upload failed. Please try again.');
  await dialog.locator('.app-toast-dismiss').focus();
  await page.keyboard.press('Enter');
  await expect(dialog.locator('.app-toast')).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(async () => {
    const modulePath = '/src/services/toasts.ts';
    const { toast } = await import(modulePath);
    toast.error('Try the action again.', { action: { label: 'Retry', onClick: async () => {
      toast.success('Action completed.');
    } } });
  });
  await page.locator('.app-toast').getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('.app-toast [role=status]')).toHaveText('Action completed.');
  await expect(page.locator('.app-toast [role=alert]')).toHaveCount(0);
});

test('Document actions use shared success toasts and keep validation inline', async ({ page, request }) => {
  const user = await createUser(request, 'toast-action');
  await login(page, user.username);
  await openSection(page, 'My Documents');
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New folder', exact: true });
  await dialog.getByLabel('Name', { exact: true }).fill('Toast test folder');
  await page.route('**/api/documents/folders?*', async route => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'Choose another folder name.' }) });
    } else {
      await route.continue();
    }
  });
  await dialog.getByRole('button', { name: 'Create folder', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Choose another folder name.');
  await expect(page.locator('.app-toast')).toHaveCount(0);
  await page.unroute('**/api/documents/folders?*');
  await dialog.getByRole('button', { name: 'Create folder', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.app-toast [role=status]')).toHaveText('Folder created.');
  await page.locator('.app-toast-dismiss').click();
  await expect(page.locator('.app-toast')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Toast test folder', exact: true })).toBeVisible();
});
