import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { adminEmail, adminPassword } from './tests/helpers.js';

export default function globalSetup() {
  if (process.env.E2E_USE_EXISTING_SERVERS === '1') return;
  execFileSync('dotnet', ['run', '--project', fileURLToPath(new URL('./Seed/Seed.csproj', import.meta.url)), '--configuration', 'Release'], {
    env: { ...process.env, E2E_ADMIN_EMAIL: adminEmail, E2E_ADMIN_PASSWORD: adminPassword },
    stdio: 'inherit',
  });
}
