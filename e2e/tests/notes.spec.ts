import { expect, test } from '@playwright/test';
import { createUser, login, openSection, uniqueName } from './helpers.js';

test('create, search, pin, edit, and delete a note', async ({ page, request }) => {
  const user = await createUser(request, 'notes');
  await login(page, user.username);
  await openSection(page, 'Notes');
  await page.getByRole('button', { name: 'New note' }).click();
  const form = page.getByRole('form', { name: 'New note' });
  await form.getByLabel('Title').fill('Design notes');
  await form.getByLabel('Content').fill('First draft');
  await form.getByRole('button', { name: 'Create note' }).click();
  await page.getByRole('button', { name: 'Close note' }).click();
  const card = page.locator('.notes-card').filter({ hasText: 'Design notes' });
  await expect(card).toBeVisible();
  await page.getByRole('textbox', { name: 'Search notes' }).fill('no match');
  await expect(page.getByText('No matching notes')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search notes' }).fill('Design');
  await card.getByRole('button', { name: 'Pin' }).click();
  await expect(card).toContainText('Pinned');
  await card.getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('form', { name: 'Edit note' });
  await edit.getByLabel('Content').fill('Second draft');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('dialog', { name: 'Design notes' })).toContainText('Second draft');
  await page.getByRole('button', { name: 'Close note' }).click();
  await expect(card).toContainText('Second draft');
  await card.getByRole('button', { name: 'View Design notes' }).click();
  await expect(page.getByRole('dialog', { name: 'Design notes' })).toContainText('Second draft');
  await page.getByRole('button', { name: 'Close note' }).click();
  await card.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog', { name: 'Delete note' }).getByRole('button', { name: 'Delete' }).click();
  await expect(card).toHaveCount(0);
});
test('share a note with view permission', async ({ browser, request }) => {
  const owner = await createUser(request, 'noteowner');
  const colleague = await createUser(request, 'noteguest');
  const title = uniqueName('Shared notes');
  const ownerPage = await browser.newPage();
  const guestPage = await browser.newPage();
  try {
    await login(ownerPage, owner.username);
    await openSection(ownerPage, 'Notes');
    await ownerPage.getByRole('button', { name: 'New note' }).click();
    const form = ownerPage.getByRole('form', { name: 'New note' });
    await form.getByLabel('Title').fill(title);
    await form.getByLabel('Content').fill('Read this handoff');
    await form.getByRole('button', { name: 'Create note' }).click();
    await ownerPage.getByRole('button', { name: 'Close note' }).click();
    await ownerPage.locator('.notes-card').filter({ hasText: title }).getByRole('button', { name: 'Share', exact: true }).click();
    const share = ownerPage.getByRole('dialog', { name: new RegExp(title) });
    await share.getByLabel('Add a person').fill(colleague.username);
    await share.getByRole('option', { name: new RegExp(colleague.username) }).click();
    await share.getByRole('button', { name: 'Share', exact: true }).click();
    await expect(share.locator('.notes-share-person').filter({ hasText: colleague.username })).toBeVisible();
    await share.getByRole('button', { name: 'Close', exact: true }).click();
    await ownerPage.getByRole('tab', { name: 'Shared by me' }).click();
    await expect(ownerPage.locator('.notes-card').filter({ hasText: title })).toBeVisible();

    await login(guestPage, colleague.username);
    await openSection(guestPage, 'Notes');
    await guestPage.getByRole('tab', { name: 'Shared with me' }).click();
    const card = guestPage.locator('.notes-card').filter({ hasText: title });
    await expect(card).toContainText('Can view');
    await expect(card.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await card.getByRole('button', { name: `View ${title}` }).click();
    await expect(guestPage.getByRole('dialog', { name: title })).toContainText('Read this handoff');
  } finally {
    await ownerPage.close();
    await guestPage.close();
  }
});

