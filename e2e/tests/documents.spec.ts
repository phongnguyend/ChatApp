import { expect, test } from '@playwright/test';
import { createUser, login, openSection, uniqueName } from './helpers.js';

test('folders, uploads, conflicts, versions, clone, search, and trash', async ({ page, request }) => {
  const user = await createUser(request, 'documents');
  const folder = uniqueName('Project');
  const file = `${uniqueName('brief')}.txt`;
  await login(page, user.username);
  await openSection(page, 'My Documents');

  await page.getByRole('button', { name: 'New folder' }).click();
  await page.getByRole('dialog', { name: 'New folder' }).getByLabel('Name').fill(folder);
  await page.getByRole('dialog', { name: 'New folder' }).getByRole('button', { name: 'Create folder' }).click();
  const folderRow = page.locator('.documents-row').filter({ has: page.getByRole('button', { name: folder, exact: true }) });
  await expect(folderRow).toBeVisible();
  await folderRow.getByRole('button', { name: `Properties for ${folder}` }).click();
  await expect(page.getByRole('dialog', { name: 'Properties' })).toContainText(folder);
  await page.getByRole('button', { name: 'Close properties' }).click();
  await folderRow.getByRole('button', { name: folder, exact: true }).click();
  await page.getByLabel('Choose files to upload').setInputFiles({ name: file, mimeType: 'text/plain', buffer: Buffer.from('First version') });
  const fileRow = page.locator('.documents-row').filter({ has: page.getByRole('button', { name: `Properties for ${file}` }) });
  await expect(fileRow).toBeVisible();

  await page.getByLabel('Choose files to upload').setInputFiles({ name: file, mimeType: 'text/plain', buffer: Buffer.from('Second version') });
  await page.getByRole('button', { name: 'Replace existing' }).click();
  await expect(fileRow).toBeVisible();
  await fileRow.getByRole('button', { name: `Version history for ${file}` }).click();
  await expect(page.getByRole('dialog', { name: 'Version history' }).getByText('Version 1')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Version history' }).getByText('Version 2')).toBeVisible();
  await page.getByRole('button', { name: 'Close version history' }).click();

  await fileRow.getByRole('button', { name: `Clone ${file} in this folder` }).click();
  await expect(page.locator('.documents-row').filter({ hasText: file.replace('.txt', ' - Copy.txt') })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search all documents' }).fill(file);
  await expect(fileRow).toBeVisible();
  await page.getByRole('textbox', { name: 'Search all documents' }).clear();
  await fileRow.getByRole('button', { name: `Move ${file} to Trash` }).click();
  await page.getByRole('dialog', { name: 'Move to Trash?' }).getByRole('button', { name: 'Move to Trash' }).click();
  await expect(fileRow).toHaveCount(0);
  await page.getByRole('tab', { name: 'Trash' }).click();
  await expect(fileRow).toBeVisible();
  await fileRow.getByRole('button', { name: `Restore ${file}` }).click();
  await expect(fileRow).toHaveCount(0);
  await page.getByRole('tab', { name: 'My Documents', exact: true }).click();
  await page.getByRole('button', { name: folder, exact: true }).first().click();
  await expect(fileRow).toBeVisible();
});
