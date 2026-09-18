import { expect, test } from '@playwright/test';
import { createUser, login, openSection, uniqueName } from './helpers.js';

test('internal and public file sharing', async ({ browser, request }) => {
  const owner = await createUser(request, 'fileowner');
  const guest = await createUser(request, 'fileguest');
  const file = `${uniqueName('handoff')}.txt`;
  const ownerPage = await browser.newPage();
  const guestPage = await browser.newPage();
  try {
    await login(ownerPage, owner.username);
    await openSection(ownerPage, 'My Documents');
    await ownerPage.getByLabel('Choose files to upload').setInputFiles({ name: file, mimeType: 'text/plain', buffer: Buffer.from('Shared handoff') });
    const row = ownerPage.locator('.documents-row').filter({ has: ownerPage.getByRole('button', { name: `Properties for ${file}` }) });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: `Share ${file}` }).click();
    const share = ownerPage.getByRole('dialog', { name: new RegExp(file.replace('.', '\\.')) });
    await share.getByLabel('Add a person').fill(guest.username);
    await share.locator('.documents-people-results button').filter({ hasText: guest.username }).click();
    await share.getByLabel('Permission').selectOption('viewer');
    await share.getByRole('button', { name: 'Share', exact: true }).click();
    await expect(share.locator('.documents-share-person').filter({ hasText: guest.username })).toBeVisible();
    await share.getByRole('tab', { name: 'Public share' }).click();
    await share.getByLabel('Expiry date (optional)').fill('2030-12-31');
    await share.getByRole('button', { name: 'Create public link' }).click();
    await expect(share.getByLabel('Public link')).toHaveValue(/publicDocument=/);
    await expect(share.getByAltText('QR code for the public document link')).toBeVisible();
    await share.getByRole('button', { name: 'Close sharing' }).click();
    await ownerPage.getByRole('tab', { name: 'Shared by me' }).click();
    await expect(ownerPage.locator('.documents-row').filter({ hasText: file })).toBeVisible();

    await login(guestPage, guest.username);
    await openSection(guestPage, 'My Documents');
    await guestPage.getByRole('tab', { name: 'Shared with me' }).click();
    const shared = guestPage.locator('.documents-row').filter({ hasText: file });
    await expect(shared).toBeVisible();
    await expect(shared.getByRole('button', { name: `Rename ${file}` })).toHaveCount(0);
  } finally {
    await ownerPage.close();
    await guestPage.close();
  }
});

test('bulk copy and move files between folders', async ({ page, request }) => {
  const owner = await createUser(request, 'filemove');
  const folder = uniqueName('Destination');
  const archive = uniqueName('Archive');
  const file = `${uniqueName('outline')}.txt`;
  await login(page, owner.username);
  await openSection(page, 'My Documents');
  await page.getByRole('button', { name: 'New folder' }).click();
  await page.getByRole('dialog', { name: 'New folder' }).getByLabel('Name').fill(folder);
  await page.getByRole('dialog', { name: 'New folder' }).getByRole('button', { name: 'Create folder' }).click();
  await page.getByRole('button', { name: 'New folder' }).click();
  await page.getByRole('dialog', { name: 'New folder' }).getByLabel('Name').fill(archive);
  await page.getByRole('dialog', { name: 'New folder' }).getByRole('button', { name: 'Create folder' }).click();
  await page.getByLabel('Choose files to upload').setInputFiles({ name: file, mimeType: 'text/plain', buffer: Buffer.from('Move this') });
  const row = page.locator('.documents-row').filter({ has: page.getByRole('button', { name: `Properties for ${file}` }) });
  await expect(row).toBeVisible();
  await row.getByRole('checkbox', { name: `Select ${file}` }).check();
  await page.locator('.documents-selection-bar').getByRole('button', { name: 'Copy' }).click();
  await page.getByRole('dialog', { name: 'Copy 1 item' }).getByRole('button', { name: folder }).click();
  await page.getByRole('dialog', { name: 'Copy 1 item' }).getByRole('button', { name: 'Copy here' }).click();
  await expect(row).toBeVisible();
  await page.getByRole('button', { name: folder, exact: true }).first().click();
  await expect(row).toBeVisible();
  await row.getByRole('checkbox', { name: `Select ${file}` }).check();
  await page.locator('.documents-selection-bar').getByRole('button', { name: 'Move', exact: true }).click();
  await page.getByRole('dialog', { name: 'Move 1 item' }).getByRole('button', { name: 'My Documents' }).click();
  await page.getByRole('dialog', { name: 'Move 1 item' }).getByRole('button', { name: archive }).click();
  await page.getByRole('dialog', { name: 'Move 1 item' }).getByRole('button', { name: 'Move here' }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Folder path' }).getByRole('button', { name: 'My Documents' }).click();
  await expect(page.locator('.documents-row').filter({ hasText: file })).toHaveCount(1);
  await page.getByRole('button', { name: archive, exact: true }).first().click();
  await expect(row).toBeVisible();
});

test('copy a folder tree with its nested files', async ({ page, request }) => {
  const owner = await createUser(request, 'treecopy');
  const parent = uniqueName('Parent');
  const child = uniqueName('Child');
  const file = `${uniqueName('nested')}.txt`;
  await login(page, owner.username);
  await openSection(page, 'My Documents');
  for (const name of [parent, child]) {
    await page.getByRole('button', { name: 'New folder' }).click();
    await page.getByRole('dialog', { name: 'New folder' }).getByLabel('Name').fill(name);
    await page.getByRole('dialog', { name: 'New folder' }).getByRole('button', { name: 'Create folder' }).click();
    await page.getByRole('button', { name, exact: true }).first().click();
  }
  await page.getByLabel('Choose files to upload').setInputFiles({ name: file, mimeType: 'text/plain', buffer: Buffer.from('Nested content') });
  await expect(page.locator('.documents-row').filter({ hasText: file })).toBeVisible();
  await page.getByRole('navigation', { name: 'Folder path' }).getByRole('button', { name: 'My Documents' }).click();
  await page.getByRole('checkbox', { name: `Select ${parent}` }).check();
  await page.locator('.documents-selection-bar').getByRole('button', { name: 'Copy', exact: true }).click();
  await page.getByRole('dialog', { name: 'Copy 1 item' }).getByRole('button', { name: 'Copy here' }).click();
  await page.getByRole('button', { name: `${parent} (2)`, exact: true }).first().click();
  await page.getByRole('button', { name: child, exact: true }).first().click();
  await expect(page.locator('.documents-row').filter({ hasText: file })).toBeVisible();
});
