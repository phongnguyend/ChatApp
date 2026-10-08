import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiUrl, createUser, headersFor, login } from './helpers.js';
import { createNode, csvCell, definitionIssues, flatten, moveNode, visibleAnswers, type FormDefinition, type FormDetail, type ResponsePage } from '../../frontend/src/components/forms/formModel.js';

test('owner links and respondent URL questions publish and collect only URL answers', async ({ page, browser, request }) => {
  const user = await createUser(request, 'formlinks');
  await login(page, user.username);
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Forms', exact: true }).click();
  await page.getByRole('button', { name: 'New form', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Links survey');
  await page.locator('.forms-palette').getByRole('button', { name: 'Link', exact: true }).click();
  await page.getByLabel('Link label', { exact: true }).fill('Read guidelines');
  await page.getByLabel('Link URL', { exact: true }).fill('https://example.com/guidelines');
  await expect(page.getByLabel('Open in a new tab')).toBeChecked();
  await page.locator('.forms-palette').getByRole('button', { name: 'Website / URL', exact: true }).click();
  await page.getByLabel('Question', { exact: true }).fill('Your website');
  await page.getByLabel('Required answer').check();
  await page.getByRole('button', { name: 'Publish form', exact: true }).click();
  const shareUrl = await page.getByLabel('Response link').inputValue();
  const anonymous = await browser.newPage();
  try {
    await anonymous.goto(shareUrl);
    const link = anonymous.getByRole('link', { name: /Read guidelines/ });
    await expect(link).toHaveAttribute('href', 'https://example.com/guidelines');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const website = anonymous.getByRole('textbox', { name: 'Your website', exact: true });
    await expect(website).toHaveAttribute('type', 'url');
    await website.fill('https://example.com/portfolio');
    await anonymous.getByRole('button', { name: 'Submit response' }).click();
    await expect(anonymous.getByRole('heading', { name: 'Response submitted' })).toBeVisible();
  } finally {
    await anonymous.close();
  }
  const headers = headersFor(user.username);
  const forms = await (await request.get(`${apiUrl}/api/forms/`, { headers })).json() as FormDetail[];
  const form = forms.find(item => item.title === 'Links survey')!;
  const responses = await (await request.get(`${apiUrl}/api/forms/${form.id}/responses`, { headers })).json() as ResponsePage;
  expect(Object.values(responses.items[0].answers)).toEqual([['https://example.com/portfolio']]);
  expect((await request.delete(`${apiUrl}/api/forms/${form.id}?revision=${form.revision}`, { headers })).status()).toBe(204);
});

test('attachment questions upload single and multiple files with owner-only downloads', async ({ page, request }) => {
  const user = await createUser(request, 'formfiles');
  const other = await createUser(request, 'formfilesother');
  const headers = headersFor(user.username);
  let form = await (await request.post(`${apiUrl}/api/forms/`, { headers })).json() as FormDetail;
  const base = `${apiUrl}/api/forms/${form.id}`;
  const single = { ...createNode('attachment'), id: 'single', label: 'Resume', required: true, allowedExtensions: ['.txt'], maxFileSizeMb: 1 };
  const multiple = { ...createNode('attachment'), id: 'multiple', label: 'Supporting files', allowMultipleFiles: true, maxFiles: 2, maxFileSizeMb: 10 };
  const definition = { ...form.definition, title: 'Attachment survey', nodes: [single, multiple] };
  const saved = await request.put(base, { headers, data: { revision: form.revision, definition } });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  form = await saved.json();
  form = await (await request.post(`${base}/publish`, { headers, data: { revision: form.revision } })).json();
  const endpoint = `${apiUrl}/api/public/forms/${form.shareToken}/responses`;
  expect((await request.post(endpoint, { data: { version: 1, submissionKey: randomUUID(), answers: { single: ['fake.txt'] } } })).status()).toBe(400);
  const multipart = new FormData();
  multipart.append('payload', JSON.stringify({ version: 1, submissionKey: randomUUID(), answers: {} }));
  multipart.append('single', new File(['one'], 'one.txt'));
  expect((await request.post(endpoint, { multipart })).status()).toBe(415);
  const submissionKey = randomUUID();
  const uploadEndpoint = `${apiUrl}/api/public/forms/${form.shareToken}/attachments`;
  const disallowed = await request.post(uploadEndpoint, { multipart: {
    version: '1', submissionKey, questionId: 'single',
    file: { name: 'resume.pdf', mimeType: 'application/pdf', buffer: Buffer.from('PDF') },
  } });
  expect(disallowed.status()).toBe(400);
  expect((await disallowed.json()).error).toContain('File extension is not allowed');
  const oversized = await request.post(uploadEndpoint, { multipart: {
    version: '1', submissionKey, questionId: 'single',
    file: { name: 'large.txt', mimeType: 'text/plain', buffer: Buffer.alloc(1024 * 1024 + 1) },
  } });
  expect(oversized.status()).toBe(400);
  expect((await oversized.json()).error).toBe('Each file must be at most 1 MB.');
  const atLimit = await request.post(uploadEndpoint, { multipart: {
    version: '1', submissionKey, questionId: 'single',
    file: { name: 'boundary.txt', mimeType: 'text/plain', buffer: Buffer.alloc(1024 * 1024) },
  } });
  expect(atLimit.ok(), await atLimit.text()).toBeTruthy();
  const largerAllowed = await request.post(uploadEndpoint, { multipart: {
    version: '1', submissionKey, questionId: 'multiple',
    file: { name: 'larger.txt', mimeType: 'text/plain', buffer: Buffer.alloc(6 * 1024 * 1024) },
  } });
  expect(largerAllowed.ok(), await largerAllowed.text()).toBeTruthy();
  async function stage(questionId: string) {
    const uploaded = await request.post(uploadEndpoint, { multipart: {
      version: '1', submissionKey, questionId,
      file: { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Notes') },
    } });
    expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
    return (await uploaded.json()).id as string;
  }
  const singleIds = [await stage('single'), await stage('single')];
  const invalidSingle = await request.post(endpoint, { data: { version: 1, submissionKey, answers: {}, attachments: { single: singleIds } } });
  expect(invalidSingle.status()).toBe(400);
  expect((await invalidSingle.json()).errors).toHaveProperty('single');
  const multipleIds: string[] = [];
  for (let index = 0; index < 3; index++) {
    multipleIds.push(await stage('multiple'));
  }
  const invalidMultiple = await request.post(endpoint, { data: { version: 1, submissionKey, answers: {}, attachments: { single: [singleIds[0]], multiple: multipleIds } } });
  expect(invalidMultiple.status()).toBe(400);
  expect((await invalidMultiple.json()).errors).toHaveProperty('multiple');
  await page.goto(`/?form=${form.shareToken}`);
  await expect(page.locator('input[type=file][aria-label="Resume"]')).toHaveAttribute('accept', '.txt');
  await expect(page.locator('.form-attachment-limits').first()).toContainText('1 MB each');
  await page.locator('input[type=file][aria-label="Resume"]').setInputFiles({ name: 'oversized.txt', mimeType: 'text/plain', buffer: Buffer.alloc(1024 * 1024 + 1) });
  await expect(page.getByRole('alert')).toContainText('Each file must be at most 1 MB.');
  await expect(page.locator('input[type=file][aria-label="Supporting files"]')).toHaveAttribute('accept', /\.docx.*\.pdf.*\.png/);
  const firstUpload = page.waitForResponse(value => value.url().endsWith(`/api/public/forms/${form.shareToken}/attachments`) && value.request().method() === 'POST');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Browse files for Resume' }).click();
  await (await chooserPromise).setFiles({ name: 'resume.txt', mimeType: 'text/plain', buffer: Buffer.from('My resume') });
  const uploadResponse = await firstUpload;
  expect(uploadResponse.ok(), await uploadResponse.text()).toBeTruthy();
  const uploadedFile = await uploadResponse.json() as { id: string };
  expect((await request.post(endpoint, { data: { version: 1, submissionKey: randomUUID(), answers: {}, attachments: { single: [uploadedFile.id] } } })).status()).toBe(400);
  const dropped = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['Notes'], 'notes.txt', { type: 'text/plain' }));
    transfer.items.add(new File(['Photo'], 'photo.txt', { type: 'text/plain' }));
    return transfer;
  });
  const dropzone = page.getByRole('group', { name: 'Upload files for Supporting files', exact: true });
  await expect(page.getByRole('button', { name: 'Browse files for Supporting files' })).toBeEnabled();
  await dropzone.dispatchEvent('dragenter', { dataTransfer: dropped });
  await expect(dropzone).toHaveClass(/is-dragging/);
  await dropzone.dispatchEvent('drop', { dataTransfer: dropped });
  await dropped.dispose();
  await page.getByRole('button', { name: 'Remove photo.txt' }).click();
  await page.locator('input[type=file][aria-label="Supporting files"]').setInputFiles({ name: 'extra.txt', mimeType: 'text/plain', buffer: Buffer.from('Extra') });
  await expect(page.getByRole('button', { name: 'Submit response' })).toBeEnabled();
  await expect(page.locator('.form-attachment-file')).toHaveCount(3);
  await expect(page.locator('.form-attachment-file').first()).toContainText('Uploaded');
  const rejectedDrop = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['Not allowed'], 'resume.pdf', { type: 'application/pdf' }));
    return transfer;
  });
  await page.getByRole('group', { name: 'Upload files for Resume', exact: true }).dispatchEvent('drop', { dataTransfer: rejectedDrop });
  await rejectedDrop.dispose();
  await expect(page.getByRole('alert')).toContainText('File extension is not allowed');
  await expect(page.locator('.form-attachment-file')).toHaveCount(3);
  await page.locator('input[type=file][aria-label="Supporting files"]').setInputFiles({ name: 'too-many.txt', mimeType: 'text/plain', buffer: Buffer.from('Extra') });
  await expect(page.getByRole('alert').filter({ hasText: 'Choose up to 2 files' })).toBeVisible();
  await expect(page.locator('.form-attachment-file')).toHaveCount(3);
  await page.screenshot({ path: 'test-results/form-attachments-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Browse files for Supporting files' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'test-results/form-attachments-mobile.png', fullPage: true });
  const beforeSubmit = await (await request.get(`${base}/responses`, { headers })).json() as ResponsePage;
  expect(beforeSubmit.total).toBe(0);
  const submissionRequest = page.waitForRequest(value => value.url() === endpoint && value.method() === 'POST');
  await page.getByRole('button', { name: 'Submit response' }).click();
  const submitted = (await submissionRequest).postDataJSON();
  expect(submitted.attachments.single).toHaveLength(1);
  expect(submitted.attachments.multiple).toHaveLength(2);
  await expect(page.getByRole('heading', { name: 'Response submitted' })).toBeVisible();
  const responses = await (await request.get(`${base}/responses`, { headers })).json() as ResponsePage;
  expect(responses.total).toBe(1);
  expect(responses.items[0].attachments).toHaveLength(3);
  expect((await request.post(endpoint, { data: submitted })).ok()).toBeTruthy();
  expect((await request.post(endpoint, { data: { ...submitted, submissionKey: randomUUID() } })).status()).toBe(400);
  const attachment = responses.items[0].attachments!.find(item => item.questionId === single.id)!;
  const downloadUrl = `${base}/attachments/${attachment.id}`;
  const download = await request.get(downloadUrl, { headers });
  expect(download.ok(), await download.text()).toBeTruthy();
  expect(await download.text()).toBe('My resume');
  expect(download.headers()['content-disposition']).toContain('attachment;');
  expect((await request.get(downloadUrl)).status()).toBe(401);
  expect((await request.get(downloadUrl, { headers: headersFor(other.username) })).status()).toBe(404);
  expect((await request.delete(`${base}?revision=${form.revision}`, { headers })).status()).toBe(204);
  expect((await request.get(downloadUrl, { headers })).status()).toBe(404);
});

test('owner uploads, drops, and pastes a base64 image that respondents cannot edit', async ({ page, browser, request }) => {
  const user = await createUser(request, 'formimage');
  await login(page, user.username);
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Forms', exact: true }).click();
  await page.getByRole('button', { name: 'New form', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Image survey');
  await page.locator('.forms-palette').getByRole('button', { name: 'Logo / banner', exact: true }).click();
  await page.getByLabel('Alternative text', { exact: true }).fill('Acme logo');
  const images = await page.evaluate(() => ['red', 'green', 'blue'].map(color => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const context = canvas.getContext('2d')!;
    context.fillStyle = color;
    context.fillRect(0, 0, 8, 8);
    return canvas.toDataURL('image/png');
  }));
  const upload = page.getByLabel('Upload logo or banner', { exact: true });
  await upload.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(images[0].split(',')[1], 'base64') });
  await expect(page.locator('.forms-image-preview img')).toHaveAttribute('src', images[0]);
  await upload.setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await expect(page.getByRole('alert')).toContainText('Choose a PNG, JPEG, or WebP');
  await expect(page.locator('.forms-image-preview img')).toHaveAttribute('src', images[0]);
  const dropped = await page.evaluateHandle(dataUrl => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(dataUrl.split(',')[1]), value => value.charCodeAt(0))], 'drop.png', { type: 'image/png' }));
    return transfer;
  }, images[1]);
  await page.getByRole('group', { name: 'Image upload area' }).dispatchEvent('drop', { dataTransfer: dropped });
  await dropped.dispose();
  await expect(page.locator('.forms-image-preview img')).toHaveAttribute('src', images[1]);
  await page.getByRole('group', { name: 'Image upload area' }).evaluate((element, dataUrl) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(dataUrl.split(',')[1]), value => value.charCodeAt(0))], 'paste.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, images[2]);
  await expect(page.locator('.forms-image-preview img')).toHaveAttribute('src', images[2]);
  await page.getByRole('combobox', { name: 'Image display', exact: true }).selectOption('logo');
  await page.getByRole('spinbutton', { name: 'Image height (px)' }).fill('180');
  await page.getByRole('spinbutton', { name: 'Image width (px)' }).fill('300');
  await expect(page.locator('.forms-image-preview img')).toHaveCSS('width', '300px');
  await expect(page.locator('.forms-image-preview img')).toHaveCSS('height', '180px');
  await page.locator('.forms-palette').getByRole('button', { name: 'Short answer', exact: true }).click();
  await page.getByRole('button', { name: 'Publish form', exact: true }).click();
  const url = await page.getByLabel('Response link').inputValue();
  const anonymous = await browser.newPage();
  try {
    await anonymous.goto(url);
    const logo = anonymous.getByRole('img', { name: 'Acme logo', exact: true });
    await expect(logo).toHaveAttribute('src', images[2]);
    await expect(logo).toHaveCSS('height', '180px');
    await expect(logo).toHaveCSS('width', '300px');
    await expect.poll(() => logo.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(8);
    await expect(anonymous.locator('input[type=file]')).toHaveCount(0);
    await expect(anonymous.getByRole('button', { name: /Upload image|Replace image|Remove image/ })).toHaveCount(0);
    await anonymous.getByRole('button', { name: 'Submit response' }).click();
    await expect(anonymous.getByRole('heading', { name: 'Response submitted' })).toBeVisible();
  } finally {
    await anonymous.close();
  }
  const headers = headersFor(user.username);
  const list = await (await request.get(`${apiUrl}/api/forms/`, { headers })).json() as FormDetail[];
  const form = list.find(item => item.title === 'Image survey')!;
  const saved = await (await request.get(`${apiUrl}/api/forms/${form.id}`, { headers })).json() as FormDetail;
  expect(saved.definition.nodes[0].imageDataUrl).toBe(images[2]);
  expect(saved.definition.nodes[0].imageHeight).toBe(180);
  expect(saved.definition.nodes[0].imageWidth).toBe(300);
  const responses = await (await request.get(`${apiUrl}/api/forms/${form.id}/responses`, { headers })).json() as ResponsePage;
  expect(responses.items[0].answers).not.toHaveProperty(saved.definition.nodes[0].id);
  await request.delete(`${apiUrl}/api/forms/${form.id}?revision=${form.revision}`, { headers });
});

test('form model preserves nested moves, prevents cycles, and excludes hidden answers', () => {
  const choice = { ...createNode('yesno'), id: 'choice' };
  const hidden = { ...createNode('text'), id: 'hidden', conditions: [{ questionId: 'choice', operator: 'equals', value: 'Yes' }] };
  const columns = createNode('columns');
  columns.children[0].children.push(hidden);
  const nodes = [choice, columns];
  expect(visibleAnswers(nodes, { choice: ['No'], hidden: ['stale'] }).answers).toEqual({ choice: ['No'] });
  expect(visibleAnswers(nodes, { choice: ['Yes'], hidden: ['kept'] }).answers.hidden).toEqual(['kept']);
  expect(moveNode(nodes, columns.id, columns.children[0].id, 0)).toBe(nodes);
  const moved = moveNode(nodes, hidden.id, columns.children[1].id, 0);
  expect(moved[1].children[0].children).toHaveLength(0);
  expect(moved[1].children[1].children[0].id).toBe('hidden');
  expect(csvCell('=HYPERLINK("bad")')).toBe('"\'=HYPERLINK(""bad"")"');
  expect(definitionIssues({ title: 'Test', description: '', confirmationMessage: '', nodes: [hidden, choice] })).toHaveLength(1);
});

test('Forms API enforces ownership, publication snapshots, validation, retries, and deletion', async ({ request }) => {
  const owner = await createUser(request, 'formowner');
  const stranger = await createUser(request, 'formother');
  const headers = headersFor(owner.username);
  const otherHeaders = headersFor(stranger.username);
  expect((await request.get(`${apiUrl}/api/forms/`)).status()).toBe(401);
  const created = await request.post(`${apiUrl}/api/forms/`, { headers });
  expect(created.ok(), await created.text()).toBeTruthy();
  let form = await created.json() as FormDetail;
  const base = `${apiUrl}/api/forms/${form.id}`;
  const publicBase = `${apiUrl}/api/public/forms/${form.shareToken}`;
  expect((await request.get(publicBase)).status()).toBe(404);
  expect((await request.get(base, { headers: otherHeaders })).status()).toBe(404);
  const qrUrl = `${base}/qr-code?baseUrl=${encodeURIComponent('https://example.test/chat/')}`;
  expect((await request.get(qrUrl)).status()).toBe(401);
  expect((await request.get(qrUrl, { headers: otherHeaders })).status()).toBe(404);
  expect((await request.get(`${base}/qr-code?baseUrl=javascript:alert(1)`, { headers })).status()).toBe(400);
  const qr = await request.get(qrUrl, { headers });
  expect(qr.ok(), await qr.text()).toBeTruthy();
  expect(qr.headers()['content-type']).toBe('image/png');
  expect(qr.headers()['cache-control']).toBe('no-store');
  expect((await qr.body()).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect((await request.get(`${base}/responses`, { headers: otherHeaders })).status()).toBe(404);
  expect((await request.post(`${base}/duplicate`, { headers: otherHeaders })).status()).toBe(404);
  expect((await request.delete(`${base}?revision=1`, { headers: otherHeaders })).status()).toBe(404);
  const choice = { ...createNode('yesno'), id: 'choice', label: 'More details?', required: true };
  const email = { ...createNode('email'), id: 'email', required: true, conditions: [{ questionId: choice.id, operator: 'equals', value: 'Yes' }] };
  const columns = createNode('columns');
  columns.children[0].children = [email];
  columns.children[1].children = [createNode('columns')];
  const definition: FormDefinition = { title: 'Version one', description: 'Nested survey', confirmationMessage: 'Thanks!', nodes: [choice, columns] };
  const invalid = { ...definition, nodes: [email, choice] };
  expect((await request.put(base, { headers, data: { revision: form.revision, definition: invalid } })).status()).toBe(400);
  expect((await request.put(base, { headers: otherHeaders, data: { revision: form.revision, definition } })).status()).toBe(404);
  const saved = await request.put(base, { headers, data: { revision: form.revision, definition } });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  form = await saved.json();
  expect((await request.put(base, { headers, data: { revision: 1, definition } })).status()).toBe(409);
  expect((await request.post(`${base}/publish`, { headers: otherHeaders, data: { revision: form.revision } })).status()).toBe(404);
  const published = await request.post(`${base}/publish`, { headers, data: { revision: form.revision } });
  expect(published.ok(), await published.text()).toBeTruthy();
  form = await published.json();
  const publicForm = await (await request.get(publicBase)).json();
  expect(publicForm.definition.title).toBe('Version one');
  expect(publicForm).not.toHaveProperty('ownerId');
  expect((await request.post(`${publicBase}/responses`, { data: { version: 1, submissionKey: randomUUID(), answers: {} } })).status()).toBe(400);
  expect((await request.post(`${publicBase}/responses`, { data: { version: 1, submissionKey: randomUUID(), answers: { choice: ['Yes'] } } })).status()).toBe(400);
  const submission = { version: 1, submissionKey: randomUUID(), answers: { choice: ['No'], email: ['hidden@example.com'], unknown: ['forged'] } };
  const attempts = await Promise.all([request.post(`${publicBase}/responses`, { data: submission }), request.post(`${publicBase}/responses`, { data: submission })]);
  for (const response of attempts) {
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  let responses = await (await request.get(`${base}/responses`, { headers })).json() as ResponsePage;
  expect(responses.total).toBe(1);
  expect(responses.items[0].answers).toEqual({ choice: ['No'] });
  const savedAgain = await request.put(base, { headers, data: { revision: form.revision, definition: { ...definition, title: 'Version two' } } });
  form = await savedAgain.json();
  expect((await (await request.get(publicBase)).json()).definition.title).toBe('Version one');
  const secondPublication = await request.post(`${base}/publish`, { headers, data: { revision: form.revision } });
  form = await secondPublication.json();
  expect(form.publishedVersion).toBe(2);
  expect((await request.post(`${publicBase}/responses`, { data: { ...submission, submissionKey: randomUUID() } })).status()).toBe(409);
  responses = await (await request.get(`${base}/responses`, { headers })).json();
  expect(responses.items[0].definition.title).toBe('Version one');
  const duplicate = await request.post(`${base}/duplicate`, { headers });
  const copy = await duplicate.json() as FormDetail;
  expect(copy.isPublished).toBe(false);
  expect(copy.shareToken).not.toBe(form.shareToken);
  expect((await (await request.get(`${apiUrl}/api/forms/${copy.id}/responses`, { headers })).json()).total).toBe(0);
  const closed = await request.post(`${base}/close`, { headers, data: { revision: form.revision } });
  form = await closed.json();
  expect((await request.get(publicBase)).status()).toBe(404);
  expect((await request.post(`${publicBase}/responses`, { data: { ...submission, version: 2, submissionKey: randomUUID() } })).status()).toBe(400);
  const deleted = await request.delete(`${base}?revision=${form.revision}`, { headers });
  expect(deleted.status(), await deleted.text()).toBe(204);
  expect((await request.get(`${base}/responses`, { headers })).status()).toBe(404);
  expect((await request.delete(`${apiUrl}/api/forms/${copy.id}?revision=${copy.revision}`, { headers })).status()).toBe(204);
});

test('build nested conditional form by drag and drop, publish, submit anonymously, and export', async ({ page, browser, request }, testInfo) => {
  const user = await createUser(request, 'formui');
  await login(page, user.username);
  await page.getByRole('navigation', { name: 'Main sections' }).getByRole('button', { name: 'Forms', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your forms' })).toBeVisible();
  await page.getByRole('button', { name: 'New form', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Customer research');
  await page.locator('.forms-palette').getByRole('button', { name: 'Short answer', exact: true }).dragTo(page.locator('.forms-canvas > .forms-block-list > .forms-drop'));
  await page.getByLabel('Question', { exact: true }).fill('Name');
  await page.getByLabel('Required answer').check();
  await page.locator('.forms-palette').getByRole('button', { name: 'Columns', exact: true }).click();
  await page.locator('.forms-column-title').filter({ hasText: 'Column 1' }).click();
  await page.locator('.forms-palette').getByRole('button', { name: 'Columns', exact: true }).click();
  await expect(page.locator('.forms-columns-builder')).toHaveCount(2);
  await page.locator('.forms-column-title').filter({ hasText: 'Column 1' }).last().click();
  await page.locator('.forms-palette').getByRole('button', { name: 'Email', exact: true }).click();
  await page.getByLabel('Question', { exact: true }).fill('Contact email');
  await page.getByLabel('Required answer').check();
  await page.getByRole('button', { name: 'Add condition' }).click();
  await page.locator('.forms-condition').getByLabel('Condition question', { exact: true }).selectOption({ label: 'Name' });
  await page.getByLabel('Value (case sensitive)').fill('Show');
  await page.locator('.forms-palette').getByRole('button', { name: 'Time', exact: true }).click();
  await page.getByLabel('Question', { exact: true }).fill('Appointment time');
  await page.getByLabel('Required answer').check();
  await page.locator('.forms-palette').getByRole('button', { name: 'Date & time', exact: true }).click();
  await page.getByLabel('Question', { exact: true }).fill('Appointment date and time');
  await page.getByLabel('Required answer').check();
  await page.screenshot({ path: testInfo.outputPath('forms-builder.png'), fullPage: true });
  await page.getByRole('button', { name: 'View JSON schema', exact: true }).click();
  const schemaDialog = page.getByRole('dialog', { name: 'JSON schema', exact: true });
  await expect(schemaDialog).toBeVisible();
  const schemaJson = await schemaDialog.getByRole('textbox', { name: 'Form JSON schema' }).inputValue();
  const draftSchema = JSON.parse(schemaJson) as FormDefinition;
  expect(draftSchema.title).toBe('Customer research');
  expect(flatten(draftSchema.nodes).filter(node => node.kind === 'columns')).toHaveLength(2);
  expect(flatten(draftSchema.nodes).find(node => node.label === 'Contact email')?.conditions[0].value).toBe('Show');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await schemaDialog.getByRole('button', { name: 'Copy JSON', exact: true }).click();
  await expect(schemaDialog.getByRole('status')).toHaveText('JSON copied to clipboard.');
  expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual(draftSchema);
  await page.keyboard.press('Escape');
  await expect(schemaDialog).toHaveCount(0);
  const canvas = page.getByRole('region', { name: 'Form canvas', exact: true });
  const paletteBefore = await page.locator('.forms-palette').boundingBox();
  const inspectorBefore = await page.locator('.forms-inspector').boundingBox();
  const headerBefore = await page.locator('.forms-header').boundingBox();
  await canvas.evaluate(element => { element.scrollTop = element.scrollHeight; });
  expect(await canvas.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator('.forms-palette').boundingBox()).toEqual(paletteBefore);
  expect(await page.locator('.forms-inspector').boundingBox()).toEqual(inspectorBefore);
  expect(await page.locator('.forms-header').boundingBox()).toEqual(headerBefore);
  expect(await page.locator('.forms-view').evaluate(element => element.scrollTop)).toBe(0);
  await canvas.evaluate(element => { element.scrollTop = 0; });
  await page.getByRole('button', { name: 'Publish form', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Share your form' })).toBeVisible();
  const url = await page.getByLabel('Response link').inputValue();
  const qrImage = page.getByRole('img', { name: 'QR code for Customer research' });
  await expect(qrImage).toBeVisible();
  await expect.poll(() => qrImage.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const qrDownloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download QR code' }).click();
  expect((await qrDownloadEvent).suggestedFilename()).toMatch(/^form-.*-qr\.png$/);
  const anonymous = await browser.newPage();
  try {
    await anonymous.goto(url);
    await expect(anonymous.getByRole('heading', { name: 'Customer research' })).toBeVisible();
    await expect(anonymous.getByRole('heading', { name: /^Column [1-4]$/ })).toHaveCount(0);
    await expect(anonymous.getByRole('textbox', { name: 'Contact email' })).toHaveCount(0);
    await anonymous.getByRole('textbox', { name: 'Name', exact: true }).fill('Show');
    await anonymous.getByRole('textbox', { name: 'Contact email' }).fill('respondent@example.com');
    await anonymous.locator('input[type="time"]').fill('09:30');
    await anonymous.locator('input[type="datetime-local"]').fill('2026-10-08T14:45');
    await anonymous.setViewportSize({ width: 390, height: 844 });
    expect(await anonymous.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await anonymous.screenshot({ path: testInfo.outputPath('forms-public-mobile.png'), fullPage: true });
    await anonymous.getByRole('button', { name: 'Submit response' }).click();
    await expect(anonymous.getByRole('heading', { name: 'Response submitted' })).toBeVisible();
  } finally {
    await anonymous.close();
  }
  await page.getByRole('button', { name: 'Responses', exact: true }).click();
  await expect(page.getByRole('heading', { name: '1 responses' })).toBeVisible();
  await page.locator('.forms-response summary').click();
  await expect(page.locator('.forms-response')).toContainText('respondent@example.com');
  await expect(page.locator('.forms-response')).toContainText('09:30');
  await expect(page.locator('.forms-response')).toContainText('2026-10-08T14:45');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('Customer_research-responses.csv');
  const downloadPath = testInfo.outputPath('responses.csv');
  await download.saveAs(downloadPath);
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Draft edit');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Customer research');
  const list = await (await request.get(`${apiUrl}/api/forms/`, { headers: headersFor(user.username) })).json() as FormDetail[];
  const form = list.find(item => item.title === 'Customer research')!;
  const detail = await (await request.get(`${apiUrl}/api/forms/${form.id}`, { headers: headersFor(user.username) })).json() as FormDetail;
  expect(flatten(detail.definition.nodes).filter(node => node.kind === 'columns')).toHaveLength(2);
  await request.delete(`${apiUrl}/api/forms/${form.id}?revision=${form.revision}`, { headers: headersFor(user.username) });
});
