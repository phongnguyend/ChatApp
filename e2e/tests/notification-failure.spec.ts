import { test, expect } from '@playwright/test';
import { adminEmail, adminPassword, login } from './helpers.js';

for (const existing of [true, false]) {
  test(`notification service failure stays contained (${existing ? 'automatic' : 'manual'} registration)`, async ({ page }) => {
    await page.addInitScript(({ existing }) => {
      const subscription = {
        options: { applicationServerKey: new Uint8Array([0]).buffer },
        toJSON: () => ({ endpoint: 'https://push.example.test/subscription', keys: { p256dh: 'test-public-key', auth: 'test-auth' } }),
        unsubscribe: async () => true,
      };
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
        register: async () => ({ pushManager: { getSubscription: async () => existing ? subscription : null, subscribe: async () => subscription } }),
        getRegistration: async () => ({ pushManager: { getSubscription: async () => null } }),
      } });
      Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'granted' });
      Notification.requestPermission = async () => 'granted';
    }, { existing });
    await page.route('**/api/push/config', route => route.fulfill({ json: { enabled: true, vapidPublicKey: 'AA==' } }));
    await page.route('**/api/push/subscriptions?**', route => route.fulfill({
      status: 500, contentType: 'text/plain',
      body: `System.Net.Http.HttpRequestException: No such host is known. Authorization: Bearer test-secret-marker ${'diagnostics'.repeat(1000)}`,
    }));
    await login(page, adminEmail, adminPassword);
    if (existing) {
      await expect(page.getByRole('button', { name: 'Push notifications are temporarily unavailable. Chat is still available.' })).toBeDisabled();
      await expect(page.locator('.chat-error')).toHaveCount(0);
    } else {
      await page.getByRole('button', { name: 'Turn on push notifications' }).click();
      await expect(page.getByRole('alert')).toHaveText('Push notifications are temporarily unavailable. Please try again later.Dismiss');
      await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
      await expect(page.locator('.chat-error')).toHaveCount(0);
    }
    await expect(page.getByText(/test-secret-marker|HttpRequestException/)).toHaveCount(0);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 });
      const header = page.locator('.layout-header');
      await expect(header).toBeVisible();
      expect(await header.evaluate(element => element.scrollWidth <= element.clientWidth)).toBeTruthy();
      const panel = await page.locator('.conversation-panel').boundingBox();
      expect(panel!.x).toBeGreaterThanOrEqual(0);
      expect(panel!.x + panel!.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: test.info().outputPath(`notifications-${width}.png`), animations: 'disabled' });
    }
  });
}
