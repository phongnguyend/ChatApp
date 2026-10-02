import { expect, test, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { createRequire } from 'node:module';
import { createUser, login, openSection, uniqueName } from './helpers.js';

async function openFile(page: Page, extension: string, mimeType: string, buffer: Buffer) {
  const name = `${uniqueName('preview')}.${extension}`;
  await page.getByLabel('Choose files to upload').setInputFiles({ name, mimeType, buffer });
  await page.getByRole('button', { name, exact: true }).click();
  return page.getByRole('dialog', { name: `Preview ${name}`, exact: true });
}

test('image preview loads authenticated content, maximizes, downloads, and retains document actions', async ({ page, request }) => {
  const user = await createUser(request, 'image-viewer');
  await login(page, user.username);
  await openSection(page, 'My Documents');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=', 'base64');
  const dialog = await openFile(page, 'png', 'image/png', png);
  await expect.poll(() => dialog.getByRole('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
  await dialog.getByRole('button', { name: 'Full screen', exact: true }).click();
  await expect.poll(async () => Math.round((await dialog.boundingBox())!.height)).toBe(page.viewportSize()!.height);
  await dialog.getByRole('button', { name: 'Restore size', exact: true }).click();
  await dialog.getByLabel('Choose replacement file').dispatchEvent('cancel', { bubbles: true });
  await expect(dialog).toBeVisible();
  const download = page.waitForEvent('download');
  await dialog.getByRole('link', { name: 'Download', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  await dialog.getByRole('button', { name: 'Properties', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Properties', exact: true })).toBeVisible();
});

test('PDF documents use the shared signing viewer and retain document actions', async ({ page, request }) => {
  const user = await createUser(request, 'pdf-viewer');
  await login(page, user.username);
  await openSection(page, 'My Documents');
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('Shared PDF viewer');
  const dialog = await openFile(page, 'pdf', 'application/pdf', Buffer.from(await pdf.save()));
  await expect(dialog.locator('.react-pdf__Page canvas').first()).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Properties', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Browser', exact: true }).click();
  await expect(dialog.locator('object[type="application/pdf"]')).toBeVisible();
  expect((await dialog.locator('object').boundingBox())!.height).toBeGreaterThan(300);
  await dialog.getByRole('button', { name: 'Full screen', exact: true }).click();
  await expect.poll(async () => Math.round((await dialog.boundingBox())!.height)).toBe(page.viewportSize()!.height);
  await dialog.getByRole('button', { name: 'Restore size', exact: true }).click();
  await dialog.getByRole('button', { name: 'In-app', exact: true }).click();
  await expect(dialog.locator('.react-pdf__Page canvas').first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('document-pdf-preview.png') });
  await dialog.getByRole('button', { name: 'Signatures', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Open signing editor', exact: true })).toBeVisible();
});

test('Word preview renders document text and closes with Escape', async ({ page, request }) => {
  const user = await createUser(request, 'word-viewer');
  await login(page, user.username);
  await openSection(page, 'My Documents');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Word preview acceptance test</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>');
  const dialog = await openFile(page, 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', await zip.generateAsync({ type: 'nodebuffer' }));
  await expect(dialog.locator('.office-word')).toContainText('Word preview acceptance test');
  await page.screenshot({ path: test.info().outputPath('word-preview.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('Excel preview preserves formats and navigates worksheets and row pages', async ({ page, request }) => {
  const user = await createUser(request, 'excel-viewer');
  await login(page, user.username);
  await openSection(page, 'My Documents');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Budget');
  sheet.getCell('A1').value = 'Budget total';
  sheet.mergeCells('A1:B1');
  sheet.getCell('A2').value = 1234.5;
  sheet.getCell('A2').numFmt = '$#,##0.00';
  sheet.getCell('A51').value = 'Last row';
  workbook.addWorksheet('Notes').getCell('A1').value = 'Second worksheet';
  const dialog = await openFile(page, 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', Buffer.from(await workbook.xlsx.writeBuffer()));
  await expect(dialog.getByRole('cell', { name: '$1,234.50', exact: true })).toBeVisible();
  await expect(dialog.getByRole('cell', { name: 'Budget total', exact: true })).toHaveAttribute('colspan', '2');
  await dialog.getByRole('button', { name: 'Rows', exact: true }).last().click();
  await expect(dialog.getByRole('cell', { name: 'Last row', exact: true })).toBeVisible();
  await dialog.getByRole('tab', { name: 'Notes', exact: true }).click();
  await expect(dialog.getByRole('cell', { name: 'Second worksheet', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('excel-preview.png') });
});

test('PowerPoint preview renders slides and navigates thumbnails', async ({ page, request }) => {
  const user = await createUser(request, 'slides-viewer');
  await login(page, user.username);
  await openSection(page, 'My Documents');
  const PptxGenJS = createRequire(import.meta.url)('pptxgenjs') as typeof import('pptxgenjs').default;
  const presentation = new PptxGenJS();
  presentation.addSlide().addText('First slide', { x: 1, y: 1, w: 5, h: 1, fontSize: 24 });
  presentation.addSlide().addText('Second slide', { x: 1, y: 1, w: 5, h: 1, fontSize: 24 });
  const dialog = await openFile(page, 'pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', await presentation.write({ outputType: 'nodebuffer' }) as Buffer);
  await expect(dialog.getByText('Slide 1 of 2', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog.getByText('Slide 2 of 2', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Slide 1', exact: true }).click();
  await expect(dialog.getByText('Slide 1 of 2', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('powerpoint-preview.png') });
});

test('invalid Office files show an error and keep the original download available', async ({ page, request }) => {
  const user = await createUser(request, 'invalid-office');
  await login(page, user.username);
  await openSection(page, 'My Documents');
  const dialog = await openFile(page, 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', Buffer.from('Invalid workbook'));
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Download', exact: true })).toBeVisible();
});
