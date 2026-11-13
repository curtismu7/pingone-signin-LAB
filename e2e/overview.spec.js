import { test, expect, shot, noUnexpectedErrors } from './helpers.js';

test('scenarios: Run all, every one green', async ({ page }) => {
  await page.goto('/#/scenarios');
  await page.getByRole('button', { name: 'Run all' }).click();
  await expect(page.getByTestId('scenario-summary')).toHaveText('16 of 16 behaved as written.');
  await expect(page.locator('[data-testid^="result-"]').filter({ hasText: 'PASS' })).toHaveCount(16);
  await expect(page.locator('[data-testid^="result-"]').filter({ hasText: 'FAIL' })).toHaveCount(0);
  await shot(page, '06-scenarios');
});

test('scenarios: one run shows expected versus actual; the vertical picker changes the cast', async ({ page }) => {
  await page.goto('/#/scenarios');
  await page.getByRole('button', { name: 'Run S01' }).click();
  await expect(page.getByTestId('result-S01')).toHaveText('PASS');
  await expect(page.getByTestId('scenario-S01').getByRole('table')).toContainText('mock:single');
  await expect(page.getByTestId('scenario-S01')).toContainText('Mark Ellison');
  await page.getByLabel('Vertical').selectOption('banking');
  await expect(page.getByTestId('scenario-S01')).toContainText('Alice Moreau');
  await expect(page.getByTestId('result-S01')).toHaveCount(0);
});

test('diagram: drag a box, Simulate, Reset', async ({ page }) => {
  await page.goto('/#/diagram');
  const node = page.locator('.react-flow__node').filter({ hasText: 'Browser' }).first();
  await expect(node).toBeVisible();
  const allTransforms = () => page.locator('.react-flow__node').evaluateAll((ns) => ns.map((n) => `${n.dataset.id}=${n.style.transform}`).sort());
  const initial = await allTransforms();
  expect(initial).toHaveLength(5);
  const before = await node.evaluate((n) => n.style.transform);
  const box = await node.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + 90, { steps: 6 });
  await page.mouse.up();
  const moved = await node.evaluate((n) => n.style.transform);
  expect(moved).not.toBe(before);

  await page.getByLabel('Speed').selectOption('4');
  await page.getByRole('button', { name: 'Simulate' }).click();
  await expect(page.getByTestId('caption')).toContainText('Step 1 of 7');
  await expect(page.locator('.react-flow__edge.edge-on')).toHaveCount(1);
  await expect(page.locator('.fbox.on')).toHaveCount(2);
  await shot(page, '07-diagram-simulate');
  await expect(page.getByTestId('caption')).toContainText('Step 7 of 7', { timeout: 15_000 });
  await page.getByLabel('Flow').selectOption('ciba');
  await expect(page.getByTestId('caption')).toContainText('Press Simulate');

  await page.locator('#main').getByRole('button', { name: 'Reset', exact: true }).click(); // the diagram's own Reset (the TopMenu's is in the header)
  await expect(page.getByTestId('caption')).toContainText('Press Simulate');
  await expect(page.locator('.react-flow__edge.edge-on')).toHaveCount(0);
  expect(await node.evaluate((n) => n.style.transform)).toBe(before);
  expect(await allTransforms()).toEqual(initial); // every box is back where it started
  // a drag, a tab change and back keeps the new position; Reset still restores it
  await page.mouse.move(box.x + box.width / 2, box.y + 10);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 80, box.y + 120, { steps: 6 }); await page.mouse.up();
  expect(await allTransforms()).not.toEqual(initial);
  await page.getByRole('tab', { name: /Scenarios/ }).click(); await page.getByRole('tab', { name: /Diagram/ }).click();
  expect(await allTransforms()).not.toEqual(initial);
  await page.locator('#main').getByRole('button', { name: 'Reset', exact: true }).click(); // the diagram's own Reset (the TopMenu's is in the header)
  expect(await allTransforms()).toEqual(initial);
});

test('light and dark theme toggle', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/#/signin');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const light = await bg();
  const picker = page.getByTestId('theme-select');
  await picker.selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await picker.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await bg()).not.toBe(light);
  await shot(page, '08-signin-dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark'); // remembered
});

test('phone width 390px: no horizontal scroll on any tab', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/signin');
  await page.getByRole('button', { name: /Open the flow/ }).click();
  for (const hash of ['signin', 'stepup', 'ciba', 'passkey', 'scenarios', 'diagram', 'raw', 'talk']) {
    await page.goto(`/#/${hash}`);
    await expect(page.getByRole('tab', { selected: true })).toBeVisible();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, `${hash} overflows by ${over}px`).toBeLessThanOrEqual(0);
  }
  await page.goto('/#/signin');
  await shot(page, '09-mobile-390-signin');
});

test('tour of every tab: zero console errors and no page errors', async ({ page, consoleErrors }) => {
  await page.goto('/');
  for (const name of ['Sign in', 'Step-up', 'CIBA', 'Passkey', 'Scenarios', 'Diagram', 'Raw', 'Talk track']) {
    await page.getByRole('tab', { name: new RegExp(name) }).click();
    await expect(page.getByRole('tab', { name: new RegExp(name) })).toHaveAttribute('aria-selected', 'true');
  }
  await page.getByRole('tab', { name: /Sign in/ }).click();
  await page.getByRole('button', { name: /Open the flow/ }).click();
  await page.getByLabel('Username').fill('mark');
  await page.getByLabel('Password', { exact: true }).fill('mock-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: /Resume/ }).click();
  await page.getByRole('button', { name: /Exchange the code/ }).click();
  await expect(page.getByTestId('signed-in')).toBeVisible();
  await page.getByRole('tab', { name: /Scenarios/ }).click();
  await page.getByRole('button', { name: 'Run all' }).click();
  await expect(page.getByTestId('scenario-summary')).toContainText('16 of 16');
  await page.getByRole('tab', { name: /Diagram/ }).click();
  await page.getByRole('button', { name: 'Simulate' }).click();
  await page.getByRole('tab', { name: /Raw/ }).click();
  await expect(page.getByTestId('raw-request').first()).toBeVisible();
  await page.getByTestId('reset').click(); // the shared TopMenu's Reset (the lab's reset-lab)
  await expect(page.getByTestId('reset-note')).toContainText('Lab reset');
  expect(consoleErrors).toEqual([]);
});

test('presenter mode: large text, raw panes hidden, banner still visible, arrow keys step the diagram', async ({ page }) => {
  await page.goto('/#/signin');
  const size = () => page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
  const normal = await size();
  await page.getByRole('button', { name: 'Present' }).click();
  expect(await size()).toBeGreaterThan(normal);
  await expect(page.getByTestId('banner')).toBeVisible();
  await expect(page.getByTestId('banner')).toContainText('MOCK: offline, no tenant');
  await expect(page.getByRole('tab', { name: /Raw/ })).toBeHidden();
  await page.getByRole('button', { name: /Open the flow/ }).click();
  await expect(page.getByTestId('flow-status')).toContainText('USERNAME_PASSWORD_REQUIRED');
  await expect(page.getByRole('region', { name: 'Trace' })).toBeHidden();
  await shot(page, '10-presenter-signin');
  await page.getByRole('tab', { name: /Diagram/ }).click();
  await expect(page.getByTestId('banner')).toBeVisible();
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('caption')).toContainText('Step 1 of 7');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('caption')).toContainText('Step 3 of 7');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('caption')).toContainText('Step 2 of 7');
  await page.getByRole('tab', { name: /Talk track/ }).click();
  await expect(page.getByTestId('banner')).toBeVisible();
  await expect(page.locator('.talk')).toContainText('npm run doctor');
  await page.getByRole('button', { name: 'Present' }).click();
  await expect(page.getByRole('tab', { name: /Raw/ })).toBeVisible();
});

test('every request the page makes carries a valid traceparent, and the mock answers with the same trace id', async ({ page }) => {
  const seen = [];
  page.on('request', (r) => { if (/\/(api|mock)\//.test(r.url())) seen.push({ url: r.url(), tp: r.headers().traceparent }); });
  const answers = [];
  page.on('response', async (r) => { if (/\/mock\//.test(r.url())) answers.push({ req: r.request().headers().traceparent, res: r.headers().traceparent }); });
  await page.goto('/#/signin');
  await page.getByRole('button', { name: /Open the flow/ }).click();
  await page.getByLabel('Username').fill('mark');
  await page.getByLabel('Password', { exact: true }).fill('mock-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: /Resume/ }).click();
  await page.getByRole('button', { name: /Exchange the code/ }).click();
  await expect(page.getByTestId('signed-in')).toBeVisible();
  await page.getByRole('tab', { name: /CIBA/ }).click();
  await page.getByRole('button', { name: /Start \(POST/ }).click();
  await expect(page.getByTestId('phone-notification')).toBeVisible();
  await page.getByRole('tab', { name: /Scenarios/ }).click();
  await page.getByRole('button', { name: 'Run S01' }).click();
  await expect(page.getByTestId('result-S01')).toHaveText('PASS');
  expect(seen.length).toBeGreaterThanOrEqual(8);
  for (const s of seen) expect(s.tp, s.url).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  expect(answers.length).toBeGreaterThan(5);
  for (const a of answers) { expect(a.res).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/); expect(a.res.split('-')[1]).toBe(a.req.split('-')[1]); expect(a.res).not.toBe(a.req); }
});

test('Reset lab (the header button) also puts the diagram boxes back', async ({ page }) => {
  await page.goto('/#/diagram');
  const positions = () => page.locator('.react-flow__node').evaluateAll((ns) => ns.map((n) => `${n.dataset.id}=${n.style.transform}`).sort());
  const node = page.locator('.react-flow__node').filter({ hasText: 'Browser' }).first(); // the box the other drag test moves
  await expect(node).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(5); // the boxes come from the data files: wait for them before reading positions
  const initial = await positions();
  const file = await (await page.request.get('/api/diagrams/pingone-signin-login')).json(); // the boxes start where the data file says
  expect(initial).toEqual(file.nodes.map((n) => `${n.id}=translate(${n.x}px, ${n.y}px)`).sort());
  const box = await node.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + 90, { steps: 6 });
  await page.mouse.up();
  expect(await positions()).not.toEqual(initial);
  await page.getByTestId('reset').click(); // the shared TopMenu's Reset (the lab's reset-lab)
  await expect(page.getByTestId('reset-note')).toContainText('Lab reset');
  expect(await positions()).toEqual(initial);
});
