import { expect, test } from '@playwright/test';
import { createUser, login, uniqueName } from './helpers.js';

test('direct conversation sends, edits, and deletes a message', async ({ browser, request }) => {
  const sender = await createUser(request, 'sender');
  const recipient = await createUser(request, 'recipient');
  const original = uniqueName('Hello');
  const edited = `${original} edited`;
  const senderPage = await browser.newPage();
  const recipientPage = await browser.newPage();
  try {
    await login(senderPage, sender.username);
    await login(recipientPage, recipient.username);
    await senderPage.getByRole('button', { name: 'Create a conversation' }).click();
    await senderPage.getByLabel('Find a person').fill(recipient.username);
    await senderPage.locator('.user-result').filter({ hasText: recipient.username }).click();
    await expect(senderPage.locator('.composer textarea')).toBeVisible();
    await senderPage.locator('.composer textarea').fill(original);
    await senderPage.getByRole('button', { name: 'Send message' }).click();
    const message = senderPage.locator('article.message').filter({ hasText: original });
    await expect(message).toBeVisible();
    await message.hover();
    await message.getByRole('button', { name: 'Edit message' }).click();
    await message.locator('.message-edit-form textarea').fill(edited);
    await message.getByRole('button', { name: 'Save' }).click();
    await expect(message).toContainText(edited);
    await message.hover();
    await message.getByRole('button', { name: 'Delete message' }).click();
    await senderPage.getByRole('alertdialog', { name: 'Delete this message?' }).getByRole('button', { name: 'Delete message' }).click();
    await expect(message).toHaveCount(0);
  } finally {
    await senderPage.close();
    await recipientPage.close();
  }
});
