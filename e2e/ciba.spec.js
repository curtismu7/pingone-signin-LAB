import { test, expect, shot, noUnexpectedErrors } from './helpers.js';

const start = async (page, { binding = 'AB12', expiry } = {}) => {
  await page.goto('/#/ciba');
  await page.getByLabel('binding_message', { exact: false }).fill(binding);
  if (expiry) await page.getByLabel(/requested_expiry/).fill(String(expiry));
  await page.getByRole('button', { name: /Start \(POST/ }).click();
  await expect(page.getByTestId('auth-req-id')).toBeVisible();
};

test('CIBA approve on the mock phone, then tokens', async ({ page, consoleErrors }) => {
  await start(page);
  await expect(page.getByTestId('phone-notification')).toBeVisible();
  await expect(page.getByTestId('phone-binding')).toHaveText('AB12');
  await shot(page, '04-ciba-phone');
  await page.getByTestId('phone').getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByTestId('phone-result')).toContainText('Approve');
  await page.getByRole('button', { name: 'Poll now' }).click();
  await expect(page.getByTestId('poll-state')).toContainText('approved');
  await expect(page.getByTestId('tokens').getByRole('table', { name: 'id_token claims' }).getByRole('row', { name: /^amr/ })).toContainText('ciba');
  expect(noUnexpectedErrors(consoleErrors, { allowResourceFailures: true })).toEqual([]);
});

test('CIBA deny shows access_denied', async ({ page }) => {
  await start(page);
  await page.getByTestId('phone').getByRole('button', { name: 'Deny' }).click();
  await page.getByRole('button', { name: 'Poll now' }).click();
  await expect(page.getByTestId('poll-state')).toContainText('access_denied');
  await expect(page.getByTestId('tokens')).toHaveCount(0);
});

test('CIBA pending, then slow_down lengthens the interval', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Poll now' }).click();
  await expect(page.getByTestId('poll-state')).toContainText('authorization_pending');
  await page.getByRole('button', { name: 'Poll now' }).click();
  await expect(page.getByTestId('poll-state')).toContainText('slow_down');
  await expect(page.getByTestId('interval')).toHaveText('10 s');
  await shot(page, '05-ciba-slow-down');
});

test('CIBA expired_token after a short requested_expiry', async ({ page }) => {
  await start(page, { expiry: 1 });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Poll now' }).click();
  await expect(page.getByTestId('poll-state')).toContainText('expired_token');
  await expect(page.getByTestId('phone')).toContainText('No request waiting');
});

test('binding_message counter is live and an over-long one is refused', async ({ page }) => {
  await page.goto('/#/ciba');
  const input = page.getByLabel('binding_message', { exact: false });
  await input.fill('abc');
  await expect(page.getByTestId('bm-count')).toContainText('3 of 8');
  await input.fill('123456789');
  await expect(page.getByTestId('bm-count')).toContainText('over the limit');
  await page.getByRole('button', { name: /Start \(POST/ }).click();
  await expect(page.getByTestId('ciba-error')).toContainText('invalid_binding_message');
});
