import { test, expect, noUnexpectedErrors, shot } from './helpers.js';

// Passkey (Mock): the browser's real navigator.credentials against Chrome's virtual authenticator (CDP WebAuthn) on
// http://localhost (an RP ID must be a domain, so not 127.0.0.1), and the simulated authenticator on 127.0.0.1.
const PORT = process.env.E2E_PORT;

async function ceremony(page) {
  await page.getByRole('button', { name: 'Get registration options' }).click();
  await page.getByRole('button', { name: 'Create the passkey' }).click();
  await expect(page.getByTestId('reg-clientdata')).toContainText('webauthn.create');
  await page.getByRole('button', { name: 'Verify the registration' }).click();
  await expect(page.getByTestId('reg-checks').getByRole('status')).toContainText('Verified: mark');
  await page.getByRole('button', { name: 'Get sign-in options' }).click();
  await page.getByRole('button', { name: 'Sign with the passkey' }).click();
  await expect(page.getByTestId('auth-clientdata')).toContainText('webauthn.get');
  await page.getByRole('button', { name: 'Verify the assertion' }).click();
  await expect(page.getByTestId('auth-checks').getByRole('status')).toContainText('Verified: mark');
  await page.getByRole('button', { name: 'Replay the same assertion' }).click();
  await expect(page.getByTestId('replay-checks').getByRole('status')).toContainText(/Refused: .*challenge/);
}

test('this browser\'s passkey (CDP virtual authenticator) on localhost: register, sign in, replay refused', async ({ page, consoleErrors }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  await page.goto(`http://localhost:${PORT}/#/passkey`);
  await expect(page.getByTestId('auth-browser')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('banner')).toContainText('MOCK');
  await page.getByRole('button', { name: 'Get registration options' }).click();
  await expect(page.getByLabel('registration options')).toContainText('rp.idlocalhost');
  await ceremony(page);
  // the passkey really lives in the (virtual) authenticator, bound to rp.id localhost; the RP saw UV and a counter
  const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
  expect(credentials).toHaveLength(1);
  expect(credentials[0].rpId).toBe('localhost');
  expect(credentials[0].isResidentCredential).toBe(true);
  await expect(page.getByTestId('reg-authdata').getByTestId('flag-UV')).toContainText('UV set');
  await expect(page.getByTestId('auth-checks').locator('[data-check="signature"]')).toHaveAttribute('data-ok', '1');
  await shot(page, '20-passkey-browser');
  expect(noUnexpectedErrors(consoleErrors, { allowResourceFailures: true })).toEqual([]); // the replay is a deliberate 400
});

test('on 127.0.0.1 the browser\'s passkeys are refused with the RP ID reason; the simulated authenticator runs the ceremony', async ({ page, consoleErrors }) => {
  await page.goto('/#/passkey');
  await expect(page.getByTestId('auth-browser')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('browser-unavailable')).toContainText('IP address');
  await expect(page.getByTestId('sim-note')).toContainText('SIMULATED');
  await ceremony(page);
  await expect(page.getByTestId('auth-authdata')).toContainText('1 (stored before: 0)');
  await expect(page.getByTestId('passkey-real')).toContainText('needs tenant setup');
  expect(noUnexpectedErrors(consoleErrors, { allowResourceFailures: true })).toEqual([]);
});

test('passkey tab at 375px, dark: no horizontal scroll with the whole ceremony on screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/#/passkey');
  await ceremony(page);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `overflows by ${over}px`).toBeLessThanOrEqual(0);
  await shot(page, '21-passkey-375-dark');
});
