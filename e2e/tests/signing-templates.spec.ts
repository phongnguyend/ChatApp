import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { apiUrl, createUser, headersFor, login, openSection, uniqueName } from './helpers.js';

test('templates are personal layouts with CRUD, validation, and stripped values', async ({ request }) => {
  const owner = await createUser(request, 'templates');
  const other = await createUser(request, 'other-template');
  const headers = headersFor(owner.username);
  const path = `${apiUrl}/api/signing-templates`;
  const field = { id: 'signature', type: 'signature', page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.1, value: 'private image data' };
  const input = { name: 'Contract', pageCount: 1, fields: [field] };
  expect((await request.get(path)).status()).toBe(401);
  const response = await request.post(path, { headers, data: input });
  expect(response.ok(), await response.text()).toBeTruthy();
  const saved = await response.json();
  expect(saved.id).toBeTruthy();
  expect(saved.fields[0].value).toBeNull();
  expect((await request.post(path, { headers, data: input })).status()).toBe(400);
  for (const action of ['get', 'put', 'patch', 'delete'] as const) {
    const denied = await request[action](`${path}/${saved.id}`, { headers: headersFor(other.username), data: input });
    expect(denied.status()).toBe(404);
  }
  expect(await (await request.get(path, { headers: headersFor(other.username) })).json()).toEqual([]);
  expect((await request.post(path, { headers, data: { ...input, name: 'Invalid', pageCount: 0 } })).status()).toBe(400);
  expect((await request.post(path, { headers, data: { ...input, name: 'Invalid', fields: [{ ...field, x: 2 }] } })).status()).toBe(400);
  const updated = await request.put(`${path}/${saved.id}`, { headers, data: { ...input, fields: [{ ...field, type: 'text', value: 'private text', x: 0.2 }] } });
  expect(updated.ok()).toBeTruthy();
  expect((await updated.json()).fields[0]).toMatchObject({ value: null, x: 0.2 });
  const renamed = await request.patch(`${path}/${saved.id}`, { headers, data: { name: 'Renamed' } });
  expect((await renamed.json()).name).toBe('Renamed');
  expect((await request.delete(`${path}/${saved.id}`, { headers })).ok()).toBeTruthy();
  expect((await request.get(`${path}/${saved.id}`, { headers })).status()).toBe(404);
});

test('signature images upload, drop and paste; templates save, add, replace and delete', async ({ page, request }) => {
  test.setTimeout(120_000);
  const user = await createUser(request, 'signature-image');
  await login(page, user.username);
  await openSection(page, 'My Documents');
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const name = `${uniqueName('signature')}.pdf`;
  await page.getByLabel('Choose files to upload').setInputFiles({ name, mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await page.getByRole('button', { name: `Signatures for ${name}`, exact: true }).click();
  const create = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/signatures'));
  await page.getByRole('button', { name: 'Open signing editor', exact: true }).click();
  const row = await (await create).json();
  const editor = page.getByRole('dialog', { name: `Sign — ${name}`, exact: true });
  await expect(editor.locator('.react-pdf__Page canvas').first()).toBeVisible();
  await editor.getByRole('button', { name: 'Signature', exact: true }).click();
  await editor.getByRole('button', { name: 'Sign', exact: true }).click();
  await editor.getByRole('button', { name: 'Signature field on page 1, click to sign', exact: true }).click();
  const pad = page.getByRole('dialog', { name: 'Draw your signature', exact: true });
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 90;
    const context = canvas.getContext('2d')!;
    context.font = 'italic 40px serif';
    context.fillText('Signature', 12, 55);
    return canvas.toDataURL('image/png');
  });
  await pad.getByLabel('Upload signature image').setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') });
  await expect(pad.getByRole('alert')).toContainText('PNG, JPEG, or WebP');
  await pad.getByLabel('Upload signature image').setInputFiles({ name: 'signature.png', mimeType: 'image/png', buffer: Buffer.from(png.split(',')[1], 'base64') });
  await expect(pad.getByRole('img', { name: 'Signature to apply' })).toBeVisible();
  for (const kind of ['drop', 'paste']) {
    await pad.getByRole('button', { name: 'Clear', exact: true }).click();
    await pad.locator('.signature-pad-input').evaluate((element, { png, kind }) => {
      const bytes = Uint8Array.from(atob(png.split(',')[1]), char => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'signature.png', { type: 'image/png' }));
      if (kind === 'drop') {
        element.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        element.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      }
      element.dispatchEvent(kind === 'drop'
        ? new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
        : new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
    }, { png, kind });
    await expect(pad.getByRole('img', { name: 'Signature to apply' })).toBeVisible();
    await expect(page.locator('.documents-drop-hint')).toHaveCount(0);
  }
  await page.screenshot({ path: test.info().outputPath('signature-image.png') });
  await pad.getByRole('button', { name: 'Apply', exact: true }).click();
  const savedFields = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith('/fields'));
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await savedFields).ok()).toBeTruthy();
  const path = `${apiUrl}/api/documents/files/${row.documentId}/signatures/${row.id}`;
  const headers = headersFor(user.username);
  expect((await (await request.get(`${path}/fields`, { headers })).json()).fields[0].value).toMatch(/^data:image\/png;base64,/);
  await editor.getByRole('button', { name: 'Place fields', exact: true }).click();
  await editor.getByRole('button', { name: 'Templates', exact: true }).click();
  const templates = page.getByRole('dialog', { name: 'Field templates', exact: true });
  await templates.getByLabel('New template name').fill('Reusable signature');
  await templates.getByRole('button', { name: 'Save as new', exact: true }).click();
  await expect(templates.getByRole('status').filter({ hasText: 'Saved 1 field' })).toBeVisible();
  await templates.getByRole('button', { name: 'Load', exact: true }).click();
  await templates.getByRole('button', { name: 'Add to them', exact: true }).click();
  await expect(editor.locator('.signing-field')).toHaveCount(2);
  await editor.getByRole('button', { name: 'Templates', exact: true }).click();
  await templates.getByRole('button', { name: 'Load', exact: true }).click();
  await templates.getByRole('button', { name: 'Replace them', exact: true }).click();
  await expect(editor.locator('.signing-field')).toHaveCount(1);
  await expect(editor.locator('.signing-field img')).toHaveCount(0);
  await editor.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('signing-templates.png') });
  await templates.getByRole('button', { name: 'Delete Reusable signature', exact: true }).click();
  await templates.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(templates).toContainText('No templates yet');
  await templates.getByRole('button', { name: 'Close', exact: true }).click();
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('dialog', { name: 'Unsaved changes', exact: true }).getByRole('button', { name: 'Discard changes', exact: true }).click();
  await page.getByRole('dialog', { name: `Signatures — ${name}`, exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.documents-drop-hint')).toHaveCount(0);
  const documents = page.getByRole('region', { name: 'My Documents', exact: true });
  await documents.evaluate(element => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['Normal library drop'], 'library-drop.txt', { type: 'text/plain' }));
    element.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect(page.locator('.documents-drop-hint')).toBeVisible();
  await documents.evaluate(element => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['Normal library drop'], 'library-drop.txt', { type: 'text/plain' }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect(page.locator('.documents-drop-hint')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'library-drop.txt', exact: true })).toBeVisible();
});
