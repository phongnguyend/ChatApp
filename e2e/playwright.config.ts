import { defineConfig, devices } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const frontendUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5174';
const apiUrl = process.env.E2E_API_URL ?? 'http://localhost:5046';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: frontendUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.E2E_USE_EXISTING_SERVERS === '1' ? undefined : [
    {
      command: `dotnet run --project backend/ChatApp.Api/ChatApp.Api.csproj --configuration Release --no-launch-profile --urls ${apiUrl}`,
      cwd: root,
      url: `${apiUrl}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        ASPNETCORE_ENVIRONMENT: 'Development',
        Authentication__Jwt__SigningKey: randomBytes(32).toString('base64'),
        ConnectionStrings__ChatDatabase: process.env.E2E_CONNECTION_STRING ??
          'Server=(localdb)\\mssqllocaldb;Database=ChatAppE2E;Trusted_Connection=True;TrustServerCertificate=True',
        UploadStorage__Provider: 'Local',
        UploadStorage__Path: resolve(here, 'uploads'),
        Calling__AzureCommunicationServices__ConnectionString:
          'endpoint=https://example.communication.azure.com/;accesskey=YWJjZA==',
        AllowedOrigins__0: frontendUrl,
        Monitoring__OpenTelemetry__IsEnabled: 'false',
      },
    },
    {
      command: `${npm} run dev -- --host localhost --port 5174 --strictPort`,
      cwd: resolve(root, 'frontend'),
      url: frontendUrl,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { VITE_API_URL: apiUrl },
    },
  ],
});
