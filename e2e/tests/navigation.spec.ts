import { expect, test } from '@playwright/test';
import { createUser, login, openSection } from './helpers.js';

test('sign in, switch theme, and navigate the work sections', async ({ page, request }) => {
  const user = await createUser(request, 'nav');
  await login(page, user.username);

  await page.getByRole('button', { name: /Theme: .* Choose theme/ }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.getByRole('button', { name: 'Theme: dark. Choose theme' })).toBeVisible();

  for (const section of ['Notifications', 'Meetings', 'Calendar', 'My Documents', 'Tasks', 'Reminders', 'Notes']) {
    await openSection(page, section);
  }
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Chat', exact: true })).toHaveAttribute('aria-current', 'page');
});
