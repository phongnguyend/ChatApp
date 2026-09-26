# End-to-end tests

Playwright tests for the ChatApp web UI. The suite covers sign-in, navigation and themes, direct messages, meetings and invitations, notifications, calendar, reminders, tasks, notes, documents, and sharing. Video calls and live streams are outside this suite while Azure Communication Services is disabled.

## Run locally

Install .NET SDK, Node.js, and SQL Server LocalDB. From this folder:

```powershell
npm ci
npx playwright install chromium
npm test
```

`npm run typecheck` checks the TypeScript tests. `npm run test:headed` and `npm run test:ui` help investigate failures. Playwright starts the API on port 5046 and Vite on port 5174, then stops both after the run. It uses a separate `ChatAppE2E` LocalDB database and local file storage in `e2e/uploads`. Test users have unique names; the database persists between runs. Reports and traces are written to `e2e/playwright-report` and `e2e/test-results`.

The API requires a configured calling provider at startup. The test config supplies a placeholder Azure Communication Services connection string only to pass that startup validation. No test invokes a call endpoint or joins a video call.

The test configuration generates an ephemeral JWT signing key and seeds a
test-only administrator through a separate `e2e/Seed` console utility. Tests
create ordinary accounts through the real admin
API, assign passwords, and use authenticated sessions; there is no authentication
bypass. Authentication tests cover access boundaries, password lockout, logout,
profile/password changes, role changes, and account enable/disable. External
Google/Microsoft redirects require provider registrations and are not exercised
against real providers by this suite. When using existing servers, configure the
same test administrator credentials from `tests/helpers.ts` in a disposable
environment.

For a different SQL Server connection, set `E2E_CONNECTION_STRING`. To run against servers already started elsewhere, set `E2E_USE_EXISTING_SERVERS=1`, `E2E_BASE_URL`, and `E2E_API_URL`; in that mode Playwright does not launch either server. Point those servers at a disposable test database and storage directory.
