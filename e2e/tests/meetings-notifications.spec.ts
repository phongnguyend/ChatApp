import { expect, test } from '@playwright/test';
import { createUser, login, openSection, uniqueName } from './helpers.js';

test('meeting invitations, filters, reschedule notification, and cancellation', async ({ browser, request }) => {
  const organizer = await createUser(request, 'organizer');
  const invitee = await createUser(request, 'invitee');
  const title = uniqueName('Planning');
  const organizerPage = await browser.newPage();
  const inviteePage = await browser.newPage();
  try {
    await login(organizerPage, organizer.username);
    await openSection(organizerPage, 'Meetings');
    await organizerPage.getByRole('button', { name: 'New meeting' }).click();
    const form = organizerPage.getByRole('form', { name: 'New meeting' });
    await form.getByLabel('Title').fill(title);
    await form.getByLabel('Start date').fill('2030-05-20');
    await form.getByLabel('End date').fill('2030-05-20');
    await form.getByLabel('Start time').fill('10:00');
    await form.getByLabel('End time').fill('11:00');
    await form.getByPlaceholder('Search name or username').fill(invitee.username);
    await form.getByRole('option', { name: new RegExp(invitee.username) }).click();
    await form.getByLabel('Description').fill('Review the release plan');
    await form.getByRole('button', { name: 'Create meeting' }).click();
    await expect(organizerPage.getByRole('dialog', { name: title })).toContainText('Review the release plan');
    await organizerPage.getByRole('button', { name: 'Close meeting details' }).click();

    const filters = organizerPage.getByRole('search', { name: 'Filter meetings' });
    await filters.getByLabel('Meeting name').fill('no matching meeting');
    await expect(organizerPage.getByText('No meetings match your filters')).toBeVisible();
    await filters.getByLabel('Meeting name').fill(title);
    await expect(organizerPage.locator('.meetings-item').filter({ hasText: title })).toBeVisible();

    await login(inviteePage, invitee.username);
    await openSection(inviteePage, 'Meetings');
    await inviteePage.getByRole('tab', { name: 'Invited to' }).click();
    await expect(inviteePage.locator('.meetings-item').filter({ hasText: title })).toBeVisible();
    await openSection(inviteePage, 'Notifications');
    const invitation = inviteePage.locator('.notifications-item').filter({ hasText: title });
    await expect(invitation).toBeVisible();
    await invitation.getByRole('button', { name: `Open ${title}` }).click();
    await expect(inviteePage.getByRole('dialog', { name: title })).toContainText('Review the release plan');
    await inviteePage.getByRole('button', { name: 'Close meeting details' }).click();
    await openSection(inviteePage, 'Notifications');

    await organizerPage.locator('.meetings-item').filter({ hasText: title }).getByRole('button', { name: 'Edit' }).click();
    const edit = organizerPage.getByRole('form', { name: 'Edit meeting' });
    await edit.getByLabel('Start date').fill('2030-05-21');
    await edit.getByLabel('End date').fill('2030-05-21');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await organizerPage.getByRole('button', { name: 'Close meeting details' }).click();
    await inviteePage.getByRole('button', { name: 'Refresh' }).click();
    await expect(inviteePage.locator('.notifications-item').filter({ hasText: title })).toHaveCount(2);
    await inviteePage.getByRole('button', { name: 'Mark all as read' }).click();
    await expect(inviteePage.getByText('0 unread')).toBeVisible();

    await organizerPage.locator('.meetings-item').filter({ hasText: title }).getByRole('button', { name: 'View' }).click();
    await organizerPage.getByRole('dialog', { name: title }).getByRole('button', { name: 'Cancel meeting' }).click();
    await organizerPage.getByRole('dialog', { name: title }).getByRole('button', { name: 'Confirm cancellation' }).click();
    await expect(organizerPage.getByRole('dialog', { name: title })).toContainText('Cancelled');
    await inviteePage.getByRole('button', { name: 'Refresh' }).click();
    await expect(inviteePage.locator('.notifications-item').filter({ hasText: 'cancelled a meeting' }).filter({ hasText: title })).toBeVisible();
  } finally {
    await organizerPage.close();
    await inviteePage.close();
  }
});
