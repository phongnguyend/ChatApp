import { expect, test } from '@playwright/test';
import { adminEmail, adminPassword, createUser, login, openSection } from './helpers.js';

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


test('account and administration pages share the existing shell and navigation', async ({ page }) => {
  await login(page, adminEmail, adminPassword);
  const header = await page.locator('.layout-header').elementHandle();
  const navigation = page.getByRole('navigation', { name: 'Main sections' });
  for (const section of ['Users', 'Activity log', 'Account settings']) {
    await navigation.getByRole('button', { name: section, exact: true }).click();
    await expect(page.getByRole('heading', { name: section, exact: true })).toBeVisible();
    await expect(page.locator('.chat-shell > .account-workspace')).toBeVisible();
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(navigation.getByRole('button', { name: section, exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.conversation-panel')).toBeHidden();
    if (section !== 'Account settings') {
      const workspace = page.locator('.account-table-page');
      const table = workspace.locator('.account-table-wrap');
      await expect(table).toBeVisible();
      await expect(workspace).toHaveCSS('overflow-y', 'hidden');
      await expect(table).toHaveCSS('overflow-y', 'auto');
      const headingTop = await workspace.locator('h1').evaluate(element => element.getBoundingClientRect().top);
      await table.evaluate(element => { element.scrollTop = 200; });
      await expect.poll(() => table.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      expect(await workspace.locator('h1').evaluate(element => element.getBoundingClientRect().top)).toBe(headingTop);
      expect(await workspace.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBeTruthy();
    }
    expect(await header!.evaluate(element => element.isConnected)).toBeTruthy();
    await openSection(page, 'Notes');
    await expect(page.locator('.account-workspace')).toHaveCount(0);
  }
  await navigation.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.locator('.conversation-panel')).toBeVisible();
  await page.setViewportSize({ width: 900, height: 540 });
  await navigation.getByRole('button', { name: 'Account settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Account settings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
  await expect(page.locator('.conversation-panel')).toBeVisible();
});
