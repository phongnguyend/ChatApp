import { expect, test } from '@playwright/test';
import { createUser, login, openSection } from './helpers.js';

test('sign in, switch theme, and navigate the work sections', async ({ page, request }) => {
  const user = await createUser(request, 'nav');
  await login(page, user.username);
  await expect(page.getByRole('progressbar', { name: 'Document storage used' })).toHaveCount(0);
  await expect(page.locator('.layout-header').getByRole('button', { name: 'Edit your profile' })).toBeVisible();
  await expect(page.locator('.layout-header').getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page.locator('.layout-header')).toHaveCSS('height', '64px');

  await page.getByRole('button', { name: /Theme: .* Choose theme/ }).click();
  await page.getByRole('menuitemradio', { name: 'Light' }).click();
  await expect(page.getByRole('button', { name: 'Theme: light. Choose theme' })).toBeVisible();
  await expect(page.locator('.layout-header')).toHaveCSS('background-color', 'rgb(247, 249, 248)');
  await expect(page.locator('.sidebar')).toHaveCSS('background-color', 'rgb(234, 241, 239)');
  await expect(page.locator('.conversations-panel')).toHaveCSS('background-color', 'rgb(240, 245, 244)');

  await page.getByRole('button', { name: 'Theme: light. Choose theme' }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.getByRole('button', { name: 'Theme: dark. Choose theme' })).toBeVisible();

  const mainMenuButtons = page.getByRole('navigation', { name: 'Main sections' }).getByRole('button');
  await expect(mainMenuButtons.nth(0)).toHaveAccessibleName(/^Notifications(?:[,\s]|$)/);
  await expect(mainMenuButtons.nth(1)).toHaveAccessibleName('Chat');

  for (const section of ['Notifications', 'Meetings', 'Calendar', 'My Documents', 'Tasks', 'Reminders', 'Notes']) {
    await openSection(page, section);
    await expect(page.locator('.layout-header').getByText('Huddle', { exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Conversations' })).toHaveCount(0);
    await expect(page.locator('.conversations-panel')).toHaveCount(0);
    await expect(page.locator('.sidebar')).toHaveCSS('width', '56px');
    if (section === 'My Documents') {
      await expect(page.getByRole('progressbar', { name: 'Document storage used' })).toBeVisible();
    }
  }
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Chat', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('navigation', { name: 'Conversations' })).toBeVisible();
  await expect(page.locator('.sidebar')).toHaveCSS('width', '56px');
  await expect(page.locator('.conversations-panel')).toBeVisible();
  await expect(page.locator('.conversations-panel')).toHaveCSS('width', '274px');
});
