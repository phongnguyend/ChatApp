import { expect, test } from '@playwright/test';
import { createUser, login, uniqueName } from './helpers.js';

test('pastes a clipboard image into the draft and sends it with existing attachments', async ({ page, context, request }) => {
  const user = await createUser(request, 'clipboard');
  await login(page, user.username);
  const composer = page.locator('.composer textarea');
  await expect(composer).toBeEnabled();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const caption = uniqueName('Clipboard image');
  await composer.fill(caption);
  await page.locator('.composer input[type="file"]').setInputFiles({
    name: 'existing.txt', mimeType: 'text/plain', buffer: Buffer.from('Existing attachment'),
  });
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 20;
    canvas.height = 20;
    canvas.getContext('2d')!.fillRect(0, 0, 20, 20);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  });
  await composer.focus();
  await composer.press('Control+V');
  const pending = page.locator('.pending-attachment');
  await expect(pending).toHaveCount(2);
  await expect(composer).toHaveValue(caption);
  await composer.press('Control+V');
  await expect(pending).toHaveCount(3);
  await composer.press('Control+V');
  await expect(pending).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Remove image (2).png', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove image (3).png', exact: true })).toBeVisible();
  await expect(page.locator('article.message').filter({ hasText: caption })).toHaveCount(0);
  await pending.filter({ hasText: 'image.png' }).getByRole('button').click();
  await expect(pending).toHaveCount(3);
  await composer.focus();
  await composer.press('Control+V');
  await expect(pending).toHaveCount(4);
  const upload = page.waitForResponse((response) =>
    response.url().includes('/messages/attachments') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const response = await upload;
  expect(response.ok(), await response.text()).toBeTruthy();
  expect((await response.json()).attachments.map((attachment: { fileName: string }) => attachment.fileName))
    .toEqual(expect.arrayContaining(['existing.txt', 'image.png', 'image (2).png', 'image (3).png']));
  const message = page.locator('article.message').filter({ hasText: caption });
  await expect(message).toBeVisible();
  await expect(message.getByRole('img', { name: 'image.png', exact: true })).toBeVisible();
  await expect(message).toContainText('existing.txt');
  await expect(pending).toHaveCount(0);
  await page.reload();
  await expect(message.getByRole('img', { name: 'image.png', exact: true })).toBeVisible();
  await expect(message.getByRole('img', { name: 'image (2).png', exact: true })).toBeVisible();
  await expect(message.getByRole('img', { name: 'image (3).png', exact: true })).toBeVisible();

  await page.evaluate(async () => navigator.clipboard.writeText('Normal pasted text'));
  await composer.focus();
  await composer.press('Control+V');
  await expect(composer).toHaveValue('Normal pasted text');
  await expect(pending).toHaveCount(0);
});

test('clipboard images respect attachment count and size limits', async ({ page, request }) => {
  const user = await createUser(request, 'clipboard-limits');
  await login(page, user.username);
  const composer = page.locator('.composer textarea');
  await expect(composer).toBeEnabled();
  await composer.fill('Keep my draft');
  await page.locator('.composer input[type="file"]').setInputFiles(
    Array.from({ length: 5 }, (_, index) => ({
      name: `existing-${index}.txt`, mimeType: 'text/plain', buffer: Buffer.from('Keep'),
    })),
  );
  await composer.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File(['image'], 'extra.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  await expect(page.getByText('Add up to 5 attachments per message.', { exact: true })).toBeVisible();
  await expect(page.locator('.pending-attachment')).toHaveCount(5);
  await page.getByRole('button', { name: 'Remove existing-0.txt', exact: true }).click();
  await composer.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([new Uint8Array(15 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  await expect(page.getByText('"large.png" is larger than 15 MB.', { exact: true })).toBeVisible();
  await expect(page.locator('.pending-attachment')).toHaveCount(4);
  await expect(composer).toHaveValue('Keep my draft');
});
