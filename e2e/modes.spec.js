import { test, expect, noUnexpectedErrors } from './helpers.js';

const TABS = ['signin', 'stepup', 'ciba', 'scenarios', 'diagram', 'raw', 'talk'];

test('Mock | Live toggle, mode and banner are in the header on every tab; Live is refused and the page stays Mock', async ({ page, consoleErrors }) => {
  for (const tab of TABS) {
    await page.goto(`/#/${tab}`);
    await expect(page.getByRole('group', { name: 'Mode' })).toBeVisible();
    await expect(page.getByTestId('mode-mock')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('mode')).toContainText('MOCK: offline, no tenant');
    await expect(page.getByTestId('banner')).toHaveAttribute('data-state', 'mock');
    await expect(page.getByTestId('banner')).toContainText('MOCK: offline, no tenant');
  }
  await page.getByTestId('mode-live').click();
  await expect(page.getByTestId('mode-note')).toContainText('Live mode is not available in this lab');
  await expect(page.getByTestId('mode-note')).toContainText('pingone-LAB');
  await expect(page.getByTestId('mode-mock')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('mode-live')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('banner')).toContainText('MOCK');
  await page.getByTestId('mode-mock').click();
  await expect(page.getByTestId('mode-note')).toHaveCount(0);
  expect(noUnexpectedErrors(consoleErrors)).toEqual([]);
});

test('P toggles presenter mode and Esc leaves it; the banner stays; modifier keys and typing are ignored', async ({ page }) => {
  await page.goto('/#/signin');
  await expect(page.getByRole('tab', { name: /Sign in/ })).toBeVisible(); // the lab has loaded and the key handler is attached
  const present = () => page.evaluate(() => document.documentElement.dataset.present === '1');
  const settled = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); // two frames: React has applied the key
  await page.keyboard.press('p');
  await expect.poll(present).toBe(true);
  await expect(page.getByTestId('banner')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(present).toBe(false);
  for (const combo of ['Control+p', 'Meta+p', 'Alt+p']) { await page.keyboard.press(combo); await settled(); expect(await present(), combo).toBe(false); }
  await page.keyboard.press('Shift+P');
  await expect.poll(present).toBe(true);
  await expect(page.getByTestId('banner')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(present).toBe(false);
  await page.getByRole('button', { name: /Open the flow/ }).click();
  await expect(page.getByLabel('Username')).toBeEnabled();
  await page.getByLabel('Username').fill('pp');
  await page.getByLabel('Username').press('p');
  await settled();
  expect(await present()).toBe(false);
  await expect(page.getByLabel('Username')).toHaveValue('ppp');
});

test('action buttons keep focus when they are not ready: aria-disabled, not disabled; the main landmark is there', async ({ page }) => {
  await page.goto('/#/signin');
  await expect(page.getByRole('main')).toHaveCount(1);
  const resume = page.getByRole('button', { name: /Resume \(GET \/as\/resume\)/ });
  await expect(resume).toHaveAttribute('aria-disabled', 'true');
  await expect(resume).not.toHaveAttribute('disabled', /.*/);
  await resume.focus();
  await resume.click({ force: true });
  await expect(resume).toBeFocused();
  await expect(page.getByTestId('flow-status')).not.toContainText('COMPLETED');
});
