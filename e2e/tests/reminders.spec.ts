import { expect, test } from '@playwright/test';
import { createUser, login, openSection } from './helpers.js';

test('create, filter, edit, view, and delete a reminder', async ({ page, request }) => {
  const user = await createUser(request, 'reminder');
  await login(page, user.username);
  await openSection(page, 'Reminders');

  await page.getByRole('button', { name: 'New reminder' }).click();
  const form = page.getByRole('form', { name: 'New reminder' });
  await form.getByLabel('Title').fill('Pay invoice');
  await form.getByLabel('Date', { exact: true }).fill('2030-04-12');
  await form.getByLabel('Time').fill('10:30');
  await form.getByLabel('Description').fill('Quarterly billing');
  await form.getByRole('button', { name: 'Create reminder' }).click();
  const row = page.locator('.reminders-item').filter({ hasText: 'Pay invoice' });
  await expect(row).toBeVisible();

  const filters = page.getByRole('search', { name: 'Filter reminders' });
  await filters.getByLabel('Reminder name').fill('missing reminder');
  await expect(page.getByText('No reminders match your filters')).toBeVisible();
  await filters.getByRole('button', { name: 'Clear filters' }).click();
  await expect(row).toBeVisible();
  await filters.getByLabel('From date').fill('2030-04-12');
  await filters.getByLabel('To date').fill('2030-04-12');
  await expect(row).toBeVisible();
  await filters.getByLabel('Description').fill('Quarterly');
  await expect(row).toBeVisible();
  await filters.getByRole('button', { name: 'Clear filters' }).click();

  await row.getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('form', { name: 'Edit reminder' });
  await edit.getByLabel('Title').fill('Pay revised invoice');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  const revised = page.locator('.reminders-item').filter({ hasText: 'Pay revised invoice' });
  await expect(revised).toBeVisible();
  await revised.getByRole('button', { name: 'View' }).click();
  await expect(page.getByRole('dialog', { name: 'Pay revised invoice' })).toBeVisible();
  await page.getByRole('button', { name: 'Close reminder' }).click();
  await revised.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog', { name: 'Delete reminder' }).getByRole('button', { name: 'Delete' }).click();
  await expect(revised).toHaveCount(0);
});
