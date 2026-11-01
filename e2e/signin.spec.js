import { test, expect, openFlow, password, shot, noUnexpectedErrors } from './helpers.js';

test('happy login: password only, tokens decoded, cookie rotates in the trace', async ({ page, consoleErrors }) => {
  await page.goto('/');
  await expect(page.getByTestId('mode')).toHaveText('MOCK: offline, no tenant');
  await openFlow(page);
  await password(page, 'mark');
  await expect(page.getByTestId('flow-status')).toContainText('RESUME_REQUIRED');
  await page.getByRole('button', { name: /Resume/ }).click();
  await expect(page.getByTestId('flow-status')).toContainText('COMPLETED');
  await page.getByRole('button', { name: /Exchange the code/ }).click();
  await expect(page.getByTestId('signed-in')).toBeVisible();
  const tokens = page.getByTestId('tokens');
  await expect(tokens.getByRole('table', { name: 'id_token claims' }).getByRole('row', { name: /^acr/ })).toContainText('mock:single');
  await expect(tokens.getByRole('table', { name: 'id_token claims' }).getByRole('row', { name: /^amr/ })).toContainText('pwd');
  await expect(tokens.getByRole('table', { name: 'id_token claims' }).getByRole('row', { name: /^auth_time/ })).toContainText('T');
  await expect(tokens.getByRole('table', { name: 'id_token claims' }).getByRole('row', { name: /^nonce/ })).toContainText('matches the nonce we sent');
  // The trace pane has every call; the shortened cookie differs from step to step (rotation) and never shows a full value.
  const trace = await page.getByRole('region', { name: 'Trace' }).evaluate((e) => e.textContent);
  expect(trace).toContain('********');
  const cookies = [...new Set([...trace.matchAll(/set-cookie: (ST=[A-Za-z0-9_-]{6}…)/g)].map((m) => m[1]))];
  expect(cookies.length).toBeGreaterThanOrEqual(3);
  expect(trace).not.toMatch(/ST=[A-Za-z0-9_-]{12,}/);
  await shot(page, '01-signin-tokens-light');
  expect(noUnexpectedErrors(consoleErrors)).toEqual([]);
});

test('MFA login: device selection then the passcode', async ({ page }) => {
  await openFlow(page);
  await password(page, 'priya');
  await expect(page.getByTestId('flow-status')).toContainText('DEVICE_SELECTION_REQUIRED');
  await page.getByLabel(/EMAIL/).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('flow-status')).toContainText('OTP_REQUIRED');
  await page.getByLabel(/One-time passcode/).fill('424242');
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.getByRole('button', { name: /Resume/ }).click();
  await page.getByRole('button', { name: /Exchange the code/ }).click();
  await expect(page.getByTestId('tokens').getByRole('table', { name: 'id_token claims' }).getByRole('row', { name: /^acr/ })).toContainText('mock:multi');
  await expect(page.getByTestId('tokens').getByRole('table', { name: 'id_token claims' }).getByRole('row', { name: /^amr/ })).toContainText('otp');
});

test('wrong password, then success', async ({ page, consoleErrors }) => {
  await openFlow(page);
  await password(page, 'mark', 'not-the-password');
  await expect(page.getByTestId('flow-error')).toContainText('INVALID_CREDENTIALS');
  await expect(page.getByTestId('flow-error')).toContainText('Attempts used 1 of 3');
  await expect(page.getByTestId('flow-status')).toContainText('USERNAME_PASSWORD_REQUIRED');
  await password(page, 'mark');
  await expect(page.getByTestId('flow-status')).toContainText('RESUME_REQUIRED');
  expect(noUnexpectedErrors(consoleErrors, { allowResourceFailures: true })).toEqual([]);
});

test('three wrong passwords lock the account; the right password is refused too', async ({ page }) => {
  await openFlow(page);
  // One attempt at a time: wait for the counter before the next click (the error box shifts the form, and a click can miss).
  for (let i = 1; i <= 2; i++) {
    await password(page, 'dana', 'nope');
    await expect(page.getByTestId('flow-error')).toContainText(`Attempts used ${i} of 3`);
  }
  await password(page, 'dana', 'nope');
  await expect(page.getByTestId('flow-error')).toContainText('ACCOUNT_LOCKED');
  await password(page, 'dana');
  await expect(page.getByTestId('flow-error')).toContainText('ACCOUNT_LOCKED');
  await expect(page.getByTestId('flow-status')).toContainText('USERNAME_PASSWORD_REQUIRED');
  await shot(page, '02-lockout');
});

test('keyboard only: tab to the button, sign in, resume, exchange', async ({ page }) => {
  await page.goto('/#/signin');
  await expect(page.getByRole('button', { name: /Open the flow/ })).toBeVisible();
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  const focusedText = () => page.evaluate(() => (document.activeElement?.tagName === 'BUTTON' ? document.activeElement.textContent : ''));
  for (let i = 0; i < 40 && !/Open the flow/.test(await focusedText()); i++) await page.keyboard.press('Tab');
  expect(await focusedText()).toMatch(/Open the flow/);
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Username')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('mark');
  await page.keyboard.press('Tab'); await page.keyboard.type('mock-password');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Resume/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Exchange the code/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('signed-in')).toBeVisible();
});

test('there is no redirect login anywhere in the page', async ({ page }) => {
  await page.goto('/#/signin');
  await expect(page.getByRole('button', { name: /redirect/i })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /redirect|hosted login/i })).toHaveCount(0);
  expect(await page.locator('a[href*="authorize"]').count()).toBe(0);
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await openFlow(page);
  expect(requests.filter((u) => /\/mock\/authorize/.test(u)).every((u) => /response_mode=pi\.flow/.test(u))).toBeTruthy();
  expect(page.url()).toMatch(/#\/signin$/);
});
