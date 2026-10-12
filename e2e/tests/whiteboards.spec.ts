import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { apiUrl, createUser, headersFor, login } from './helpers.js';
import { newObject, type Board, type BoardUpdate } from '../../frontend/src/components/whiteboards/boardModel.js';

test('Line handles can cross both axes and preserve endpoints through undo', async ({ page, request }) => {
  const owner = await createUser(request, 'boardrotate');
  const headers = headersFor(owner.username);
  const board = await (await request.post(`${apiUrl}/api/whiteboards/`, { headers })).json() as Board;
  const base = `${apiUrl}/api/whiteboards/${board.id}`;
  const line = { ...newObject('line', { x: 250, y: 200 }, '#112233', 'transparent', 3), height: 1, points: [{ x: 0, y: 0 }, { x: 160, y: 0 }] };
  expect((await request.post(`${base}/commands`, { headers, data: { operationId: randomUUID(), edits: [{ expectedVersion: 0, object: line }] } })).ok()).toBeTruthy();
  await login(page, owner.username);
  await page.goto(`/?whiteboard=${board.id}`);
  const canvas = page.getByRole('application', { name: 'Whiteboard canvas' });
  try {
    await expect(canvas).toBeVisible();
    await canvas.click({ position: { x: 300, y: 200 } });
    for (const [index, x, y] of [[1, 150, 300], [1, 150, 100], [1, 350, 100], [0, 400, 300]]) {
      await expect(page.getByRole('button', { name: 'Apply settings' })).toBeEnabled();
      const handle = await canvas.locator(`[data-endpoint="${index}"]`).boundingBox();
      const bounds = await canvas.boundingBox();
      await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
      await page.mouse.down();
      await page.mouse.move(bounds!.x + x, bounds!.y + y, { steps: 10 });
      const saved = page.waitForResponse(response => response.url().endsWith('/commands') && response.request().method() === 'POST');
      await page.mouse.up();
      const response = await saved;
      expect(response.ok(), await response.text()).toBeTruthy();
      const object = (await response.json() as BoardUpdate).objects[0];
      expect(object.x + object.points[index].x).toBeCloseTo(x, 0);
      expect(object.y + object.points[index].y).toBeCloseTo(y, 0);
      const fixed = index === 1 ? { x: 250, y: 200 } : { x: 350, y: 100 };
      expect(object.x + object.points[1 - index].x).toBeCloseTo(fixed.x, 0);
      expect(object.y + object.points[1 - index].y).toBeCloseTo(fixed.y, 0);
    }
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.getByLabel('Start Left', { exact: true })).toHaveValue('250');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(page.getByLabel('Start Left', { exact: true })).toHaveValue('400');
    await page.getByRole('button', { name: 'Swap start/end', exact: true }).click();
    await expect(page.getByLabel('Start Left', { exact: true })).toHaveValue('350');
    await expect(page.getByLabel('Start Top', { exact: true })).toHaveValue('100');
    await expect(page.getByLabel('End Left', { exact: true })).toHaveValue('400');
    await expect(page.getByLabel('End Top', { exact: true })).toHaveValue('300');
    await expect(page.getByRole('button', { name: 'Swap start/end', exact: true })).toBeEnabled();
    const stored = (await (await request.get(base, { headers })).json() as Board).objects[0];
    expect(stored.points).toEqual([{ x: 0, y: 0 }, { x: 50, y: 200 }]);
    expect([stored.x, stored.y, stored.width, stored.height]).toEqual([350, 100, 50, 200]);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.getByLabel('Start Left', { exact: true })).toHaveValue('400');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(page.getByLabel('Start Left', { exact: true })).toHaveValue('350');
  } finally {
    await request.delete(base, { headers });
  }
});

test('Line endpoint settings preserve direction, axis-aligned lines, persistence, and undo', async ({ page, request }) => {
  const owner = await createUser(request, 'boardendpoints');
  const headers = headersFor(owner.username);
  const board = await (await request.post(`${apiUrl}/api/whiteboards/`, { headers })).json() as Board;
  const base = `${apiUrl}/api/whiteboards/${board.id}`;
  const line = { ...newObject('line', { x: 50, y: 50 }, '#112233', 'transparent', 3), height: 1, points: [{ x: 0, y: 0 }, { x: 160, y: 0 }] };
  expect((await request.post(`${base}/commands`, { headers, data: { operationId: randomUUID(), edits: [{ expectedVersion: 0, object: line }] } })).ok()).toBeTruthy();
  await login(page, owner.username);
  await page.goto(`/?whiteboard=${board.id}`);
  const canvas = page.getByRole('application', { name: 'Whiteboard canvas' });
  try {
    await expect(canvas).toBeVisible();
    await canvas.click({ position: { x: 100, y: 50 } });
    await expect(page.getByLabel('Start Left', { exact: true })).toHaveValue('50');
    await expect(page.getByLabel('End Left', { exact: true })).toHaveValue('210');
    for (const [startX, startY, endX, endY] of [[300, 180, 80, 60], [120, 30, 120, 230], [-40, 80, 200, 80]]) {
      await page.getByLabel('Start Left', { exact: true }).fill(String(startX));
      await page.getByLabel('Start Top', { exact: true }).fill(String(startY));
      await page.getByLabel('End Left', { exact: true }).fill(String(endX));
      await page.getByLabel('End Top', { exact: true }).fill(String(endY));
      const saved = page.waitForResponse(response => response.url().endsWith('/commands') && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Apply settings' }).click();
      const response = await saved;
      expect(response.ok(), await response.text()).toBeTruthy();
      const object = (await response.json() as BoardUpdate).objects[0];
      expect(object.points.map(point => ({ x: object.x + point.x, y: object.y + point.y }))).toEqual([{ x: startX, y: startY }, { x: endX, y: endY }]);
      expect(object.width).toBe(Math.max(1, Math.abs(startX - endX)));
      expect(object.height).toBe(Math.max(1, Math.abs(startY - endY)));
      await expect(page.getByRole('button', { name: 'Apply settings' })).toBeEnabled();
    }
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.getByLabel('End Top', { exact: true })).toHaveValue('230');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(page.getByLabel('Start Left', { exact: true })).toHaveValue('-40');
    await expect(page.getByRole('button', { name: 'Apply settings' })).toBeEnabled();
    const stored = await (await request.get(base, { headers })).json() as Board;
    expect(stored.objects[0].points).toEqual([{ x: 0, y: 0 }, { x: 240, y: 0 }]);
    await page.getByLabel('End Left', { exact: true }).fill('20000');
    await page.getByRole('button', { name: 'Apply settings' }).click();
    await expect(page.getByRole('alert')).toContainText('no more than 10,000 units apart');
    expect((await (await request.get(base, { headers })).json() as Board).revision).toBe(stored.revision);
  } finally {
    await request.delete(base, { headers });
  }
});

test('Whiteboard keyboard shortcuts support whole boards without interfering with text editing or viewers', async ({ page, browser, request }) => {
  const owner = await createUser(request, 'boardkeys');
  const viewer = await createUser(request, 'boardkeyviewer');
  const headers = headersFor(owner.username);
  const board = await (await request.post(`${apiUrl}/api/whiteboards/`, { headers })).json() as Board;
  const base = `${apiUrl}/api/whiteboards/${board.id}`;
  const note = { ...newObject('sticky', { x: 30, y: 30 }, '#112233', '#ffffff', 3), text: 'Keep this note' };
  const objects = [note, ...Array.from({ length: 100 }, (_, index) => newObject('rectangle', { x: 400 + index * 5, y: 200 }, '#112233', '#ffffff', 3))];
  const saved = await request.post(`${base}/commands`, { headers, data: { operationId: randomUUID(), edits: objects.map(object => ({ expectedVersion: 0, object })) } });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await request.post(`${base}/members`, { headers, data: { username: viewer.username, canEdit: false } });
  await login(page, owner.username);
  await page.goto(`/?whiteboard=${board.id}`);
  const canvas = page.getByRole('application', { name: 'Whiteboard canvas' });
  const viewerPage = await browser.newPage();
  try {
    await expect(canvas).toBeVisible();
    await canvas.click({ position: { x: 70, y: 70 } });
    const text = page.getByRole('textbox', { name: 'Text', exact: true });
    await text.fill('Edit me');
    await text.press('Control+a');
    await text.press('Delete');
    await expect(text).toHaveValue('');
    await expect(canvas.locator('[data-object-id]')).toHaveCount(101);
    await expect(canvas.locator('[data-selection]')).toHaveCount(1);
    await canvas.focus();
    await canvas.press('Control+a');
    await expect(canvas.locator('[data-selection]')).toHaveCount(101);
    await canvas.press('Delete');
    await expect(canvas.locator('[data-object-id]')).toHaveCount(0);
    for (const [shortcut, action, count] of [
      ['Control+z', 'Undo', 101], ['Control+y', 'Redo', 0],
      ['Control+z', 'Undo', 101], ['Control+Shift+z', 'Redo', 0],
      ['Meta+z', 'Undo', 101], ['Meta+Shift+z', 'Redo', 0], ['Control+z', 'Undo', 101],
    ] as const) {
      await expect(page.getByRole('button', { name: action, exact: true })).toBeEnabled();
      await canvas.press(shortcut);
      await expect(canvas.locator('[data-object-id]')).toHaveCount(count);
    }
    await expect(page.locator('.whiteboard-workspace [role=status]')).toContainText('Saved');
    const stored = await (await request.get(base, { headers })).json() as Board;
    expect(stored.objects.find(object => object.id === note.id)!.text).toBe('Keep this note');
    await canvas.click({ position: { x: 10, y: 10 } });
    await canvas.click({ position: { x: 70, y: 70 } });
    await text.fill('Local text');
    await text.press('Control+z');
    await text.press('Control+Shift+z');
    expect((await (await request.get(base, { headers })).json() as Board).revision).toBe(stored.revision);
    await login(viewerPage, viewer.username);
    await viewerPage.goto(`/?whiteboard=${board.id}`);
    const viewerCanvas = viewerPage.getByRole('application', { name: 'Whiteboard canvas' });
    await expect(viewerPage.locator('.whiteboard-workspace [role=status]')).toContainText('View only');
    await viewerCanvas.focus();
    await viewerCanvas.press('Control+a');
    await expect(viewerCanvas.locator('[data-selection]')).toHaveCount(101);
    await viewerCanvas.press('Delete');
    await viewerCanvas.press('Control+z');
    await viewerCanvas.press('Control+y');
    await expect(viewerCanvas.locator('[data-object-id]')).toHaveCount(101);
    expect((await (await request.get(base, { headers })).json() as Board).revision).toBe(stored.revision);
  } finally {
    await viewerPage.close();
    await request.delete(base, { headers });
  }
});

test('Lines save on click and when dragged horizontally, vertically, or in reverse', async ({ page, request }) => {
  const owner = await createUser(request, 'boardlines');
  const headers = headersFor(owner.username);
  const board = await (await request.post(`${apiUrl}/api/whiteboards/`, { headers })).json() as Board;
  const base = `${apiUrl}/api/whiteboards/${board.id}`;
  await login(page, owner.username);
  await page.goto(`/?whiteboard=${board.id}`);
  const canvas = page.getByRole('application', { name: 'Whiteboard canvas' });
  try {
    await expect(canvas).toBeVisible();
    await page.getByRole('button', { name: 'Line', exact: true }).click();
    const saved = page.waitForResponse(response => response.url().endsWith('/commands') && response.request().method() === 'POST');
    await canvas.click({ position: { x: 40, y: 40 } });
    const response = await saved;
    expect(response.ok(), await response.text()).toBeTruthy();
    const update = await response.json() as BoardUpdate;
    expect(update.objects[0].points).toEqual([{ x: 0, y: 0 }, { x: 160, y: 0 }]);
    for (const [start, end] of [[[50, 200], [200, 200]], [[250, 50], [250, 200]], [[450, 250], [350, 150]]]) {
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
      const bounds = (await canvas.boundingBox())!;
      await page.mouse.move(bounds.x + start[0], bounds.y + start[1]);
      await page.mouse.down();
      await page.mouse.move(bounds.x + end[0], bounds.y + end[1], { steps: 5 });
      const saving = page.waitForResponse(result => result.url().endsWith('/commands') && result.request().method() === 'POST');
      await page.mouse.up();
      const result = await saving;
      expect(result.ok(), await result.text()).toBeTruthy();
      const change = await result.json() as BoardUpdate;
      expect(change.objects[0].points).toHaveLength(2);
    }
    await expect(canvas.locator('[data-object-id]')).toHaveCount(4);
    await expect(page.locator('.whiteboard-error')).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(canvas.locator('[data-object-id]')).toHaveCount(3);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(canvas.locator('[data-object-id]')).toHaveCount(4);
  } finally {
    await request.delete(base, { headers });
  }
});

test('Dragging empty space box-selects objects with additive selection, pan, and zoom', async ({ page, request }) => {
  const owner = await createUser(request, 'boardbox');
  const headers = headersFor(owner.username);
  const board = await (await request.post(`${apiUrl}/api/whiteboards/`, { headers })).json() as Board;
  const base = `${apiUrl}/api/whiteboards/${board.id}`;
  const objects = [50, 300, 550].map(x => newObject('rectangle', { x, y: 50 }, '#112233', '#ffffff', 3));
  expect((await request.post(`${base}/commands`, { headers, data: { operationId: randomUUID(), edits: objects.map(object => ({ expectedVersion: 0, object })) } })).ok()).toBeTruthy();
  await login(page, owner.username);
  await page.goto(`/?whiteboard=${board.id}`);
  const canvas = page.getByRole('application', { name: 'Whiteboard canvas' });
  const selection = canvas.locator('[data-object-id] [data-selection]');
  try {
    await expect(canvas).toBeVisible();
    const bounds = (await canvas.boundingBox())!;
    async function drag(fromX: number, fromY: number, toX: number, toY: number) {
      await page.mouse.move(bounds.x + fromX, bounds.y + fromY);
      await page.mouse.down();
      await page.mouse.move(bounds.x + toX, bounds.y + toY, { steps: 5 });
    }
    await drag(20, 20, 500, 200);
    await expect(canvas.locator('[data-marquee]')).toBeVisible();
    await expect(selection).toHaveCount(2);
    await page.mouse.up();
    await expect(canvas.locator('[data-marquee]')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '2 objects selected' })).toBeVisible();
    await page.keyboard.down('Control');
    await drag(530, 20, 740, 180);
    await page.mouse.up();
    await page.keyboard.up('Control');
    await expect(selection).toHaveCount(3);
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await page.getByRole('button', { name: 'Pan', exact: true }).click();
    await drag(20, 250, 60, 280);
    await page.mouse.up();
    await expect(selection).toHaveCount(3);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    const zoom = 1 / 1.2;
    // Reverse-direction box selection uses board coordinates after zooming and panning.
    await drag(500 * zoom + 40, 200 * zoom + 30, 20 * zoom + 40, 20 * zoom + 30);
    await page.mouse.up();
    await expect(selection).toHaveCount(2);
    await expect(canvas.locator(`[data-object-id="${objects[2].id}"] [data-selection]`)).toHaveCount(0);
    // A cancelled drag retains the previous selection.
    await drag(20, 280, 100, 350);
    await canvas.dispatchEvent('pointercancel', { pointerId: 1 });
    await page.mouse.up();
    await expect(canvas.locator('[data-marquee]')).toHaveCount(0);
    await expect(selection).toHaveCount(2);
    await drag(20, 280, 100, 350);
    await page.mouse.up();
    await expect(selection).toHaveCount(0);
    const stored = await (await request.get(base, { headers })).json() as Board;
    expect(stored.revision).toBe(1);
    expect(stored.objects.map(object => object.x)).toEqual([50, 300, 550]);
  } finally {
    await request.delete(base, { headers });
  }
});

test('Ctrl-click toggles multiple objects for moving, copying, deletion, and undo', async ({ page, request }) => {
  const owner = await createUser(request, 'boardmultiple');
  const headers = headersFor(owner.username);
  const board = await (await request.post(`${apiUrl}/api/whiteboards/`, { headers })).json() as Board;
  const base = `${apiUrl}/api/whiteboards/${board.id}`;
  const objects = [50, 300, 550].map(x => newObject('rectangle', { x, y: 50 }, '#112233', '#ffffff', 3));
  expect((await request.post(`${base}/commands`, { headers, data: { operationId: randomUUID(), edits: objects.map(object => ({ expectedVersion: 0, object })) } })).ok()).toBeTruthy();
  await login(page, owner.username);
  await page.goto(`/?whiteboard=${board.id}`);
  const canvas = page.getByRole('application', { name: 'Whiteboard canvas' });
  const first = canvas.locator(`[data-object-id="${objects[0].id}"]`);
  const second = canvas.locator(`[data-object-id="${objects[1].id}"]`);
  try {
    await expect(canvas).toBeVisible();
    await canvas.click({ position: { x: 80, y: 80 } });
    await canvas.click({ position: { x: 330, y: 80 }, modifiers: ['Control'] });
    await expect(canvas.locator('[data-selection]')).toHaveCount(2);
    await canvas.click({ position: { x: 80, y: 80 }, modifiers: ['Control'] });
    await expect(canvas.locator('[data-selection]')).toHaveCount(1);
    await expect(second.locator('[data-selection]')).toHaveCount(1);
    await canvas.click({ position: { x: 80, y: 80 }, modifiers: ['Control'] });
    const bounds = (await canvas.boundingBox())!;
    await page.mouse.move(bounds.x + 80, bounds.y + 80);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 110, bounds.y + 100, { steps: 5 });
    await expect(first).toHaveAttribute('transform', 'translate(80 70)');
    await expect(second).toHaveAttribute('transform', 'translate(330 70)');
    await page.mouse.up();
    await expect(page.getByRole('heading', { name: '2 objects selected' })).toBeVisible();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(first).toHaveAttribute('transform', 'translate(50 50)');
    await expect(second).toHaveAttribute('transform', 'translate(300 50)');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(second).toHaveAttribute('transform', 'translate(330 70)');
    await page.getByRole('button', { name: 'Copy object', exact: true }).click();
    await page.getByRole('button', { name: 'Paste object', exact: true }).click();
    await expect(canvas.locator('[data-object-id]')).toHaveCount(5);
    await expect(canvas.locator('[data-selection]')).toHaveCount(2);
    await page.getByRole('button', { name: 'Delete object', exact: true }).click();
    await expect(canvas.locator('[data-object-id]')).toHaveCount(3);
    await canvas.click({ position: { x: 580, y: 80 }, modifiers: ['Control'] });
    await expect(canvas.locator('[data-selection]')).toHaveCount(1);
    await expect(canvas.locator('[data-resize]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(canvas.locator('[data-object-id]')).toHaveCount(5);
    await canvas.click({ position: { x: 30, y: 300 } });
    await expect(canvas.locator('[data-selection]')).toHaveCount(0);
    await canvas.click({ position: { x: 580, y: 80 } });
    await expect(canvas.locator('[data-selection]')).toHaveCount(1);
  } finally {
    await request.delete(base, { headers });
  }
});

test('Handwriting can be selected and dragged anywhere inside its bounds at different zoom levels', async ({ page, request }) => {
  const owner = await createUser(request, 'boardhandwriting');
  const headers = headersFor(owner.username);
  const board = await (await request.post(`${apiUrl}/api/whiteboards/`, { headers })).json() as Board;
  const base = `${apiUrl}/api/whiteboards/${board.id}`;
  const stroke = { ...newObject('path', { x: 50, y: 50 }, '#112233', 'transparent', 1), width: 200, height: 80, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 200, y: 80 }] };
  const dot = { ...newObject('path', { x: 400, y: 90 }, '#112233', 'transparent', 1), width: 1, height: 1, points: [{ x: 0, y: 0 }] };
  const saved = await request.post(`${base}/commands`, { headers, data: { operationId: randomUUID(), edits: [stroke, dot].map(object => ({ expectedVersion: 0, object })) } });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await login(page, owner.username);
  await page.goto(`/?whiteboard=${board.id}`);
  const canvas = page.getByRole('application', { name: 'Whiteboard canvas' });
  const path = canvas.locator(`[data-object-id="${stroke.id}"]`);
  try {
    await expect(canvas).toBeVisible();
    // Select and drag empty space well away from any painted stroke.
    await canvas.click({ position: { x: 90, y: 90 } });
    await expect(path.locator('[data-selection]')).toHaveCount(1);
    const bounds = (await canvas.boundingBox())!;
    await page.mouse.move(bounds.x + 90, bounds.y + 90);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 120, bounds.y + 110, { steps: 5 });
    await page.mouse.up();
    await expect(path).toHaveAttribute('transform', 'translate(80 70)');
    await expect(page.getByRole('button', { name: 'Apply settings' })).toBeEnabled();
    // Empty space inside the bounds selects it; outside the bounds deselects it.
    await canvas.click({ position: { x: 100, y: 110 } });
    await expect(path.locator('[data-selection]')).toHaveCount(1);
    await canvas.click({ position: { x: 300, y: 200 } });
    await expect(canvas.locator('[data-selection]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    const zoom = 1 / 1.2 / 1.2;
    await canvas.click({ position: { x: 110 * zoom, y: 110 * zoom } });
    await expect(path.locator('[data-selection]')).toHaveCount(1);
    await canvas.click({ position: { x: 400 * zoom + 8, y: 90 * zoom } });
    await expect(canvas.locator(`[data-object-id="${dot.id}"] [data-selection]`)).toHaveCount(1);
    await expect(path.locator('polyline:not([data-hit-target])')).toHaveAttribute('stroke-width', '1');
  } finally {
    await request.delete(base, { headers });
  }
});

test('Object layer controls reorder overlapping objects and support undo, redo, and persistence', async ({ page, request }) => {
  const owner = await createUser(request, 'boardlayers');
  const headers = headersFor(owner.username);
  const board = await (await request.post(`${apiUrl}/api/whiteboards/`, { headers })).json() as Board;
  const base = `${apiUrl}/api/whiteboards/${board.id}`;
  const shapes = ['#ff0000', '#00ff00', '#0000ff'].map(fill => newObject('rectangle', { x: 50, y: 50 }, '#112233', fill, 3));
  const saved = await request.post(`${base}/commands`, { headers, data: { operationId: randomUUID(), edits: shapes.map(object => ({ expectedVersion: 0, object })) } });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await login(page, owner.username);
  await page.goto(`/?whiteboard=${board.id}`);
  const canvas = page.getByRole('application', { name: 'Whiteboard canvas' });
  const ids = shapes.map(object => object.id);
  const order = () => canvas.locator('[data-object-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-object-id')));
  try {
    await expect(canvas).toBeVisible();
    await canvas.click({ position: { x: 100, y: 80 } });
    await page.getByRole('button', { name: 'Send backward', exact: true }).click();
    await expect.poll(order).toEqual([ids[0], ids[2], ids[1]]);
    await page.getByRole('button', { name: 'Bring forward', exact: true }).click();
    await expect.poll(order).toEqual(ids);
    await page.getByRole('button', { name: 'Send to back', exact: true }).click();
    await expect.poll(order).toEqual([ids[2], ids[0], ids[1]]);
    await page.getByRole('button', { name: 'Bring to front', exact: true }).click();
    await expect.poll(order).toEqual(ids);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(order).toEqual([ids[2], ids[0], ids[1]]);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(order).toEqual(ids);
    await expect(page.locator('.whiteboard-workspace [role=status]')).toContainText('Saved');
    await page.goto(`/?whiteboard=${board.id}`);
    await expect.poll(order).toEqual(ids);
    const stored = await (await request.get(base, { headers })).json() as Board;
    expect(stored.objects.find(object => object.id === ids[2])!.z).toBeGreaterThan(stored.objects.find(object => object.id === ids[1])!.z!);
  } finally {
    await request.delete(base, { headers });
  }
});

for (const tool of ['Sticky note', 'Text']) {
  test(`${tool} is placed without a prompt and its text can be configured later`, async ({ page, request }) => {
    const owner = await createUser(request, 'boardplacement');
    const headers = headersFor(owner.username);
    const board = await (await request.post(`${apiUrl}/api/whiteboards/`, { headers })).json() as Board;
    await login(page, owner.username);
    await page.goto(`/?whiteboard=${board.id}`);
    const canvas = page.getByRole('application', { name: 'Whiteboard canvas' });
    await expect(page.locator('.whiteboard-workspace [role=status]')).toContainText('Live');
    let dialogs = 0;
    page.on('dialog', async dialog => {
      dialogs++;
      await dialog.dismiss();
    });
    try {
      await page.getByRole('button', { name: tool, exact: true }).click();
      const bounds = (await canvas.boundingBox())!;
      await page.mouse.move(bounds.x + 40, bounds.y + 40);
      await page.mouse.down();
      expect(dialogs).toBe(0);
      await page.mouse.up();
      await expect(canvas.locator('[data-object-id]')).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
      await canvas.click({ position: { x: 400, y: 300 } });
      await page.mouse.move(bounds.x + 60, bounds.y + 60);
      await page.mouse.down();
      await page.mouse.move(bounds.x + 100, bounds.y + 100, { steps: 5 });
      await page.mouse.up();
      await expect(canvas.locator('[data-object-id]')).toHaveAttribute('transform', 'translate(80 80)');
      expect(dialogs).toBe(0);
      await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue(tool);
      await expect(page.getByRole('button', { name: 'Apply settings' })).toBeEnabled();
      await canvas.locator('[data-object-id]').dblclick({ position: { x: 20, y: 20 } });
      await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toBeFocused();
      await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Configured later');
      await page.getByRole('button', { name: 'Apply settings' }).click();
      await expect(canvas.locator('text').first()).toHaveText('Configured later');
      await expect(page.getByRole('button', { name: tool, exact: true })).toBeEnabled();
      await page.getByRole('button', { name: tool, exact: true }).click();
      await canvas.click({ position: { x: 400, y: 300 } });
      await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await canvas.click({ position: { x: 450, y: 350 } });
      expect(dialogs).toBe(0);
      await expect(canvas.locator('[data-object-id]')).toHaveCount(2);
      await expect(page.locator('.whiteboard-workspace [role=status]')).toContainText('Saved');
      const stored = await (await request.get(`${apiUrl}/api/whiteboards/${board.id}`, { headers })).json() as Board;
      expect(stored.objects.filter(object => !object.deleted).map(object => object.text)).toEqual(['Configured later', tool]);
    } finally {
      await request.delete(`${apiUrl}/api/whiteboards/${board.id}`, { headers });
    }
  });
}

test('Whiteboards enforce permissions, merge independent edits, reject stale edits, and restore history', async ({ request }) => {
  const owner = await createUser(request, 'boardowner');
  const editor = await createUser(request, 'boardeditor');
  const viewer = await createUser(request, 'boardviewer');
  const headers = headersFor(owner.username);
  const created = await request.post(`${apiUrl}/api/whiteboards/`, { headers });
  expect(created.ok(), await created.text()).toBeTruthy();
  const board = await created.json() as Board;
  const base = `${apiUrl}/api/whiteboards/${board.id}`;
  expect((await request.get(base)).status()).toBe(401);
  expect((await request.get(base, { headers: headersFor(editor.username) })).status()).toBe(403);
  for (const [user, canEdit] of [[editor, true], [viewer, false]] as const) {
    expect((await request.post(`${base}/members`, { headers, data: { username: user.username, canEdit } })).status()).toBe(204);
  }
  const first = newObject('rectangle', { x: 20, y: 30 }, '#112233', 'transparent', 3);
  const command = { operationId: randomUUID(), edits: [{ expectedVersion: 0, object: first }] };
  expect((await request.post(`${base}/commands`, { headers: headersFor(viewer.username), data: command })).status()).toBe(403);
  const saved = await request.post(`${base}/commands`, { headers, data: command });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  expect((await saved.json()).revision).toBe(1);
  expect((await (await request.post(`${base}/commands`, { headers, data: command })).json()).revision).toBe(1);
  const second = newObject('sticky', { x: 220, y: 30 }, '#112233', '#ffffff', 3);
  const merged = await request.post(`${base}/commands`, { headers: headersFor(editor.username), data: { operationId: randomUUID(), edits: [{ expectedVersion: 0, object: second }] } });
  expect(merged.ok(), await merged.text()).toBeTruthy();
  const moved = await request.post(`${base}/commands`, { headers, data: { operationId: randomUUID(), edits: [{ expectedVersion: 1, object: { ...first, x: 90 } }] } });
  expect(moved.ok(), await moved.text()).toBeTruthy();
  expect((await request.post(`${base}/commands`, { headers, data: { ...command, operationId: randomUUID() } })).status()).toBe(409);
  expect((await request.post(`${base}/commands`, { headers: headersFor(editor.username), data: command })).status()).toBe(409);
  expect((await request.post(`${base}/commands`, { headers, data: { operationId: randomUUID(), edits: [{ expectedVersion: 0, object: { ...second, id: randomUUID(), color: 'url(javascript:alert(1))' } }] } })).status()).toBe(400);
  expect((await request.post(`${base}/versions/1/restore`, { headers: headersFor(editor.username), data: { expectedRevision: 3 } })).status()).toBe(403);
  expect((await request.post(`${base}/versions/1/restore`, { headers, data: { expectedRevision: 1 } })).status()).toBe(409);
  const restored = await request.post(`${base}/versions/1/restore`, { headers, data: { expectedRevision: 3 } });
  expect(restored.ok(), await restored.text()).toBeTruthy();
  const result = await restored.json() as Board;
  expect(result.objects.filter(x => !x.deleted)).toHaveLength(1);
  expect(result.objects.find(x => x.id === first.id)?.x).toBe(20);
  expect(result.objects.find(x => x.id === second.id)?.deleted).toBeTruthy();
  expect((await request.delete(`${base}/members/${editor.id}`, { headers })).status()).toBe(204);
  expect((await request.get(base, { headers: headersFor(editor.username) })).status()).toBe(403);
  expect((await request.delete(base, { headers })).status()).toBe(204);
});

test('Whiteboard drawing, settings, undo/redo, images, and live collaboration', async ({ page, browser, request }) => {
  const owner = await createUser(request, 'boardui');
  const editor = await createUser(request, 'boardlive');
  await login(page, owner.username);
  await page.getByRole('button', { name: 'Whiteboards', exact: true }).click();
  await page.getByRole('button', { name: 'New whiteboard', exact: true }).click();
  const canvas = page.getByRole('application', { name: 'Whiteboard canvas' });
  await expect(canvas).toBeVisible();
  await expect(page.locator('.whiteboard-workspace [role=status]')).toContainText('Live');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + 50, bounds.y + 50);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 210, bounds.y + 150, { steps: 5 });
  const saved = page.waitForResponse(response => response.url().endsWith('/commands') && response.request().method() === 'POST');
  await page.mouse.up();
  const update = await (await saved).json() as BoardUpdate;
  const base = `${apiUrl}/api/whiteboards/${update.boardId}`;
  await expect(canvas.locator('[data-object-id]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await page.getByLabel('Object width').fill('240');
  await page.getByRole('button', { name: 'Apply settings' }).click();
  await expect(canvas.locator('[data-object-id] > rect').first()).toHaveAttribute('width', '240');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(canvas.locator('[data-object-id] > rect').first()).toHaveAttribute('width', '160');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(canvas.locator('[data-object-id]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(canvas.locator('[data-object-id]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(canvas.locator('[data-object-id] > rect').first()).toHaveAttribute('width', '240');
  await page.getByRole('button', { name: 'Copy object' }).click();
  await page.getByRole('button', { name: 'Paste object' }).click();
  await expect(canvas.locator('[data-object-id]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByLabel('Username', { exact: true }).fill(editor.username);
  await page.getByRole('button', { name: 'Grant access', exact: true }).click();
  await expect(page.locator('.whiteboard-inspector')).toContainText(editor.username);
  const secondPage = await browser.newPage();
  try {
    await login(secondPage, editor.username);
    await secondPage.goto(`/?whiteboard=${update.boardId}`);
    const otherCanvas = secondPage.getByRole('application', { name: 'Whiteboard canvas' });
    await expect(otherCanvas.locator('[data-object-id]')).toHaveCount(2);
    await expect(secondPage.locator('.whiteboard-workspace [role=status]')).toContainText('Live');
    await secondPage.getByRole('button', { name: 'Ellipse', exact: true }).click();
    const otherBounds = (await otherCanvas.boundingBox())!;
    await secondPage.mouse.move(otherBounds.x + 300, otherBounds.y + 200);
    await secondPage.mouse.down();
    await secondPage.mouse.move(otherBounds.x + 430, otherBounds.y + 290, { steps: 5 });
    await secondPage.mouse.up();
    await expect(canvas.locator('ellipse')).toHaveCount(1);
    await expect(canvas.locator('[data-cursor]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Close panel' }).click();
    await page.locator('.whiteboard-toolbar input[type=file]').setInputFiles({ name: 'sketch.png', mimeType: 'image/png', buffer: await canvas.screenshot() });
    await expect(canvas.locator('image')).toHaveCount(1);
    await expect(otherCanvas.locator('image')).toHaveCount(1);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export SVG' }).click();
    const exported = await download;
    const svg = await readFile((await exported.path())!, 'utf8');
    expect(svg).toContain('data:image/png;base64,');
    expect(svg).not.toContain('data-selection');
    await page.screenshot({ path: 'test-results/whiteboard-workspace.png' });
    await page.reload();
    await page.getByRole('button', { name: 'Whiteboards', exact: true }).click();
    await page.getByRole('button', { name: /Untitled whiteboard.*Your board/ }).click();
    await expect(canvas.locator('[data-object-id]')).toHaveCount(4);
    await request.delete(`${base}/members/${editor.id}`, { headers: headersFor(owner.username) });
    await expect(otherCanvas.locator('[data-object-id]')).toHaveCount(0);
  } finally {
    await secondPage.close();
    await request.delete(base, { headers: headersFor(owner.username) });
  }
});

test('Failed saves can be retried and undo cannot overwrite a newer collaborator edit', async ({ page, request }) => {
  const owner = await createUser(request, 'boardretry');
  const headers = headersFor(owner.username);
  await login(page, owner.username);
  await page.getByRole('button', { name: 'Whiteboards', exact: true }).click();
  await page.getByRole('button', { name: 'New whiteboard', exact: true }).click();
  await expect(page.locator('.whiteboard-workspace [role=status]')).toContainText('Live');
  await page.route('**/api/whiteboards/*/commands', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary outage' }) }));
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const canvas = page.getByRole('application', { name: 'Whiteboard canvas' });
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + 40, bounds.y + 40);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 140, bounds.y + 140, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  await expect(canvas.locator('[data-object-id]')).toHaveCount(1);
  await page.unroute('**/api/whiteboards/*/commands');
  const saved = page.waitForResponse(response => response.url().endsWith('/commands'));
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  const change = await (await saved).json() as BoardUpdate;
  const base = `${apiUrl}/api/whiteboards/${change.boardId}`;
  const object = change.objects[0];
  const remote = await request.post(`${base}/commands`, { headers, data: { operationId: randomUUID(), edits: [{ expectedVersion: object.version, object: { ...object, x: 300 } }] } });
  expect(remote.ok(), await remote.text()).toBeTruthy();
  await expect(canvas.locator('[data-object-id]')).toHaveAttribute('transform', 'translate(300 40)');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Another collaborator changed this object');
  const board = await (await request.get(base, { headers })).json() as Board;
  expect(board.objects[0].x).toBe(300);
  expect(board.objects[0].deleted).toBe(false);
  await request.delete(base, { headers });
});
