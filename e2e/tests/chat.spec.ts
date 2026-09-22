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
    await message.locator('.message-body').hover();
    await message.getByRole('button', { name: 'Pin message' }).click();
    const pinnedSummary = senderPage.getByRole('button', { name: /1 pinned message/ });
    await expect(pinnedSummary).toBeVisible();
    await pinnedSummary.click();
    await senderPage.locator('.pinned-message-item').filter({ hasText: original })
      .getByRole('button', { name: new RegExp(original) }).click();
    await expect(message).toHaveClass(/message-jump-highlight/);
    await message.locator('.message-body').hover();
    await message.getByRole('button', { name: 'Unpin message' }).click();
    await expect(pinnedSummary).toHaveCount(0);
    await message.locator('.message-body').hover();
    await message.getByRole('button', { name: 'Edit message' }).click();
    await message.locator('.message-edit-form textarea').fill(edited);
    await message.getByRole('button', { name: 'Save' }).click();
    await expect(message).toContainText(edited);
    await message.locator('.message-body').hover();
    await message.getByRole('button', { name: 'Delete message' }).click({ force: true });
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

test('creates a poll, lists it in the Polls tab, and synchronizes a vote', async ({ browser, request }) => {
  const sender = await createUser(request, 'poll-sender');
  const recipient = await createUser(request, 'poll-recipient');
  const question = uniqueName('Where should we meet?');
  const firstOption = uniqueName('Conference room');
  const secondOption = uniqueName('Cafe');
  const senderPage = await browser.newPage();
  const recipientPage = await browser.newPage();
  try {
    await login(senderPage, sender.username);
    await login(recipientPage, recipient.username);
    await senderPage.getByRole('button', { name: 'Create a conversation' }).click();
    await senderPage.getByLabel('Find a person').fill(recipient.username);
    await senderPage.locator('.user-result').filter({ hasText: recipient.username }).click();

    await senderPage.getByRole('button', { name: 'Create a poll' }).click();
    const pollDialog = senderPage.getByRole('form', { name: 'Create a poll' });
    await pollDialog.getByLabel('Question').fill(question);
    await pollDialog.getByRole('radio', { name: /Multiple choice/ }).check();
    const expiration = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 16);
    await pollDialog.getByLabel(/Expiration/).fill(expiration);
    await pollDialog.getByRole('textbox', { name: 'Option 1' }).fill(firstOption);
    await pollDialog.getByRole('textbox', { name: 'Option 2' }).fill(secondOption);
    const optionRows = pollDialog.locator('.poll-dialog-option');
    await optionRows.nth(1).getByRole('button', { name: 'Reorder option 2' })
      .dragTo(optionRows.nth(0));
    await expect(pollDialog.getByRole('textbox', { name: 'Option 1' })).toHaveValue(secondOption);
    await expect(pollDialog.getByRole('textbox', { name: 'Option 2' })).toHaveValue(firstOption);
    await pollDialog.getByRole('button', { name: 'Create poll' }).click();

    const senderPoll = senderPage.getByRole('region', { name: `Poll: ${question}` });
    await expect(senderPoll).toBeVisible();
    await expect(senderPoll).toContainText('0 voters');
    await expect(senderPoll).toContainText('Multiple choice');
    await expect(senderPoll).toContainText('Closes');
    await expect(senderPoll.locator('.message-poll-option-text')).toHaveText([
      secondOption,
      firstOption,
    ]);

    const recipientConversation = recipientPage
      .getByRole('navigation', { name: 'Conversations' })
      .locator('.conversation-item')
      .filter({ hasText: sender.username });
    await expect(recipientConversation).toBeVisible();
    await recipientConversation.click();

    await recipientPage.getByRole('tab', { name: /Polls/ }).click();
    const pollsPanel = recipientPage.getByRole('tabpanel', { name: /Polls/ });
    await expect(pollsPanel.getByRole('heading', { name: 'Polls in this conversation' })).toBeVisible();
    const recipientPoll = pollsPanel.getByRole('region', { name: `Poll: ${question}` });
    await expect(recipientPoll).toBeVisible();
    const vote = recipientPoll.getByRole('checkbox', { name: new RegExp(firstOption) });
    await vote.click();
    await expect(vote).toHaveAttribute('aria-checked', 'true');
    await expect(recipientPoll).toContainText('1 voter');
    await expect(senderPoll).toContainText('1 voter');

    const changedVote = recipientPoll.getByRole('checkbox', { name: new RegExp(secondOption) });
    await changedVote.click();
    await expect(changedVote).toHaveAttribute('aria-checked', 'true');
    await expect(vote).toHaveAttribute('aria-checked', 'true');
    await expect(recipientPoll).toContainText('1 voter');

    await vote.click();
    await expect(vote).toHaveAttribute('aria-checked', 'false');
    await expect(changedVote).toHaveAttribute('aria-checked', 'true');
    await expect(recipientPoll).toContainText('1 voter');

    const singleQuestion = uniqueName('Choose one time');
    const morning = uniqueName('Morning');
    const afternoon = uniqueName('Afternoon');
    await senderPage.getByRole('button', { name: 'Create a poll' }).click();
    const singlePollDialog = senderPage.getByRole('form', { name: 'Create a poll' });
    await singlePollDialog.getByLabel('Question').fill(singleQuestion);
    await singlePollDialog.getByRole('textbox', { name: 'Option 1' }).fill(morning);
    await singlePollDialog.getByRole('textbox', { name: 'Option 2' }).fill(afternoon);
    await singlePollDialog.getByRole('button', { name: 'Create poll' }).click();

    const singlePoll = pollsPanel.getByRole('region', { name: `Poll: ${singleQuestion}` });
    await expect(singlePoll).toBeVisible();
    await expect(singlePoll).toContainText('Single choice');
    await expect(singlePoll).toContainText('No expiration');
    const morningVote = singlePoll.getByRole('radio', { name: new RegExp(morning) });
    const afternoonVote = singlePoll.getByRole('radio', { name: new RegExp(afternoon) });
    await morningVote.click();
    await expect(morningVote).toHaveAttribute('aria-checked', 'true');
    await afternoonVote.click();
    await expect(afternoonVote).toHaveAttribute('aria-checked', 'true');
    await expect(morningVote).toHaveAttribute('aria-checked', 'false');
    await expect(singlePoll).toContainText('1 voter');
  } finally {
    await senderPage.close();
    await recipientPage.close();
  }
});
