import { test, expect, shot, noUnexpectedErrors } from './helpers.js';

test('step-up: 401 challenge parsed, re-authorize, retry succeeds', async ({ page, consoleErrors }) => {
  await page.goto('/#/stepup');
  await page.getByRole('button', { name: 'Sign in (low acr)' }).click();
  await expect(page.getByTestId('low-acr')).toHaveText('mock:single');
  await page.getByRole('button', { name: 'Call POST /rs/transfer' }).click();
  const ch = page.getByTestId('challenge');
  await expect(ch).toContainText('insufficient_user_authentication');
  await expect(page.getByTestId('challenge-acr')).toContainText('mock:multi');
  await expect(page.getByRole('button', { name: 'Re-authorize (step up)' })).toBeEnabled();
  await shot(page, '03-stepup-challenge');
  await page.getByRole('button', { name: 'Re-authorize (step up)' }).click();
  await expect(page.getByTestId('high-acr')).toHaveText('mock:multi');
  await page.getByRole('button', { name: 'Retry POST /rs/transfer' }).click();
  await expect(page.getByTestId('retry-ok')).toContainText('"transferred":true');
  const trace = await page.getByRole('region', { name: 'Trace' }).evaluate((e) => e.textContent);
  expect(trace).toContain('www-authenticate: Bearer error="insufficient_user_authentication"');
  expect(noUnexpectedErrors(consoleErrors, { allowResourceFailures: true })).toEqual([]);
});
