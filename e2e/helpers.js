import fs from 'node:fs';
import path from 'node:path';
import { test as base, expect } from '@playwright/test';

export const SHOTS = process.env.E2E_SHOTS || path.resolve(import.meta.dirname, '../test-results/shots');
fs.mkdirSync(SHOTS, { recursive: true });

// Every test starts from a clean lab and collects console errors and uncaught page errors.
// Chrome logs every 4xx fetch as a console "error" (Failed to load resource). Tests that refuse on purpose list the statuses they expect.
export const test = base.extend({
  consoleErrors: async ({ page }, use) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await use(errors);
  },
});
test.beforeEach(async ({ request }) => { expect((await request.post('/api/reset', { data: {} })).ok()).toBeTruthy(); });

export const noUnexpectedErrors = (errors, { allowResourceFailures = false } = {}) => errors.filter((e) => !(allowResourceFailures && /Failed to load resource/.test(e)));
export const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
export { expect };

export async function openFlow(page) {
  await page.goto('/#/signin');
  await page.getByRole('button', { name: /Open the flow/ }).click();
  await expect(page.getByTestId('flow-status')).toContainText('USERNAME_PASSWORD_REQUIRED');
}
export async function password(page, user, pw = 'mock-password') {
  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password', { exact: true }).fill(pw);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
