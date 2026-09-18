import { expect, test } from '@playwright/test';
import { createUser, login, openSection, uniqueName } from './helpers.js';

test('task status needs confirmation and supports bulk selection', async ({ page, request }) => {
  const user = await createUser(request, 'tasks');
  await login(page, user.username);
  await openSection(page, 'Tasks');

  for (const title of ['Prepare agenda', 'Send summary']) {
    await page.getByRole('button', { name: 'New task' }).click();
    const form = page.getByRole('form', { name: 'New task' });
    await form.getByLabel('Title').fill(title);
    await form.getByLabel('Due date').fill('2030-05-15');
    await form.getByLabel('Priority').selectOption('high');
    await form.getByRole('button', { name: 'Add task' }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  }
  await page.getByRole('checkbox', { name: 'Select all' }).check();
  await page.locator('.tasks-bulk-actions').getByRole('button', { name: 'Done', exact: true }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Confirm task status' });
  await expect(confirm).toContainText('2 tasks');
  await confirm.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('tab', { name: /Completed/ }).click();
  await expect(page.getByRole('heading', { name: 'Prepare agenda' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Send summary' })).toBeVisible();
  await page.locator('.tasks-item').filter({ hasText: 'Prepare agenda' }).getByRole('button', { name: 'Undone: Prepare agenda' }).click();
  await page.getByRole('alertdialog', { name: 'Confirm task status' }).getByRole('button', { name: 'Undone' }).click();
  await page.getByRole('tab', { name: /To do/ }).click();
  await expect(page.getByRole('heading', { name: 'Prepare agenda' })).toBeVisible();
});

test('share and assign a task to another person', async ({ browser, request }) => {
  const owner = await createUser(request, 'taskowner');
  const colleague = await createUser(request, 'taskguest');
  const title = uniqueName('Review draft');
  const ownerPage = await browser.newPage();
  const guestPage = await browser.newPage();
  try {
    await login(ownerPage, owner.username);
    await openSection(ownerPage, 'Tasks');
    await ownerPage.getByRole('button', { name: 'New task' }).click();
    await ownerPage.getByRole('form', { name: 'New task' }).getByLabel('Title').fill(title);
    await ownerPage.getByRole('form', { name: 'New task' }).getByRole('button', { name: 'Add task' }).click();
    const row = ownerPage.locator('.tasks-item').filter({ hasText: title });
    await row.getByRole('button', { name: `Share ${title}` }).click();
    const share = ownerPage.getByRole('dialog', { name: new RegExp(title) });
    await share.getByLabel('Add a person').fill(colleague.username);
    await share.getByRole('option', { name: new RegExp(colleague.username) }).click();
    await share.getByLabel('Permission').selectOption('editor');
    await share.getByRole('button', { name: 'Share', exact: true }).click();
    await expect(share.locator('.tasks-share-person').filter({ hasText: colleague.username })).toBeVisible();
    await share.getByRole('button', { name: 'Close', exact: true }).click();
    await row.getByRole('button', { name: `Assign ${title}` }).click();
    const assignment = ownerPage.getByRole('dialog', { name: new RegExp(title) });
    await assignment.getByLabel('Assigned to').selectOption(colleague.id);
    await assignment.getByRole('button', { name: 'Save assignment' }).click();
    await ownerPage.getByRole('tab', { name: 'Shared by me' }).click();
    await expect(ownerPage.locator('.tasks-item').filter({ hasText: title })).toBeVisible();

    await login(guestPage, colleague.username);
    await openSection(guestPage, 'Tasks');
    await guestPage.getByRole('tab', { name: 'Shared with me' }).click();
    await expect(guestPage.locator('.tasks-item').filter({ hasText: title })).toContainText('Can edit');
    await openSection(guestPage, 'Notifications');
    await expect(guestPage.locator('.notifications-item').filter({ hasText: title })).toHaveCount(2);
  } finally {
    await ownerPage.close();
    await guestPage.close();
  }
});


