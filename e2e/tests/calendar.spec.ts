import { expect, test } from '@playwright/test';
import { createUser, login, openSection, uniqueName } from './helpers.js';

test('navigate weeks and create a reminder from the calendar', async ({ page, request }) => {
  const user = await createUser(request, 'calendar');
  const title = uniqueName('Calendar reminder');
  await login(page, user.username);
  await openSection(page, 'Calendar');
  const week = page.getByRole('button', { name: /^Choose week/ });
  const firstWeek = await week.getAttribute('aria-label');
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(week).not.toHaveAttribute('aria-label', firstWeek ?? '');
  await page.getByRole('button', { name: 'Previous week' }).click();
  await expect(week).toHaveAttribute('aria-label', firstWeek ?? '');
  await week.click();
  await expect(page.getByRole('dialog', { name: 'Choose a week' })).toBeVisible();
  await week.click();

  await page.getByRole('button', { name: 'New reminder' }).click();
  const form = page.getByRole('dialog', { name: 'New reminder' });
  const date = await form.getByLabel('Date').inputValue();
  await form.getByLabel('Title').fill(title);
  await form.getByLabel('All day').check();
  await form.getByRole('button', { name: 'Create reminder' }).click();
  await expect(page.getByRole('dialog', { name: title })).toBeVisible();
  await page.getByRole('button', { name: 'Close reminder details' }).click();
  await openSection(page, 'Reminders');
  await expect(page.locator('.reminders-item').filter({ hasText: title })).toBeVisible();
  await page.getByRole('search', { name: 'Filter reminders' }).getByLabel('From date').fill(date);
  await expect(page.locator('.reminders-item').filter({ hasText: title })).toBeVisible();
});
