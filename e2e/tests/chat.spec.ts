import { expect, test } from '@playwright/test';
import { createUser, login, openSection, uniqueName } from './helpers.js';

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
    await message.getByRole('button', { name: 'Pin message' }).click();
    const pinnedSummary = senderPage.getByRole('button', { name: /1 pinned message/ });
    await expect(pinnedSummary).toBeVisible();
    await pinnedSummary.click();
    await senderPage.locator('.pinned-message-item').filter({ hasText: original })
      .getByRole('button', { name: new RegExp(original) }).click();
    await expect(message).toHaveClass(/message-jump-highlight/);
    await message.hover();
    await message.getByRole('button', { name: 'Unpin message' }).click();
    await expect(pinnedSummary).toHaveCount(0);
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

test('tags a conversation member and links their notification to the message', async ({ browser, request }) => {
  const sender = await createUser(request, 'tag-sender');
  const recipient = await createUser(request, 'tag-recipient');
  const note = uniqueName('Please review');
  const senderPage = await browser.newPage();
  const recipientPage = await browser.newPage();
  try {
    await login(senderPage, sender.username);
    await login(recipientPage, recipient.username);
    await senderPage.getByRole('button', { name: 'Create a conversation' }).click();
    await senderPage.getByLabel('Find a person').fill(recipient.username);
    await senderPage.locator('.user-result').filter({ hasText: recipient.username }).click();

    const composer = senderPage.locator('.composer textarea');
    await composer.fill('@');
    const mentionOptions = senderPage.getByRole('listbox', { name: 'Tag a person' });
    await expect(mentionOptions).toBeVisible();
    await mentionOptions.getByRole('option', { name: new RegExp(recipient.username) }).click();
    await composer.pressSequentially(note);
    await expect(composer).toHaveValue(`@${recipient.username} ${note}`);
    await senderPage.getByRole('button', { name: 'Send message' }).click();

    const sentMessage = senderPage.locator('article.message').filter({ hasText: note });
    await expect(sentMessage.locator('.message-mention')).toHaveText(`@${recipient.username}`);

    await openSection(recipientPage, 'Notifications');
    const notification = recipientPage.locator('.notifications-item')
      .filter({ hasText: 'mentioned you in a message' })
      .filter({ hasText: note });
    await expect(notification).toBeVisible();
    await notification.locator('.notifications-copy').click();

    const receivedMessage = recipientPage.locator('article.message').filter({ hasText: note });
    await expect(receivedMessage).toBeVisible();
    await expect(receivedMessage).toHaveClass(/message-jump-highlight/);
    await expect(receivedMessage.locator('.message-mention')).toHaveText(`@${recipient.username}`);

    const broadcastNote = uniqueName('Everyone please review');
    await composer.fill('@every');
    await senderPage.getByRole('listbox', { name: 'Tag a person' })
      .getByRole('option', { name: /Everyone @everyone/ })
      .click();
    await composer.pressSequentially(broadcastNote);
    await senderPage.getByRole('button', { name: 'Send message' }).click();

    await openSection(recipientPage, 'Notifications');
    const everyoneNotification = recipientPage.locator('.notifications-item')
      .filter({ hasText: 'mentioned you in a message' })
      .filter({ hasText: broadcastNote });
    await expect(everyoneNotification).toBeVisible();
  } finally {
    await senderPage.close();
    await recipientPage.close();
  }
});
