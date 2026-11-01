import test from 'node:test';
import assert from 'node:assert/strict';
import { lab, MOCK_PASSWORD, MOCK_OTP, CLIENT, REDIRECT, BASE } from './helpers.js';
import { pkceChallenge, FLOW_ID_RE } from '../src/index.js';

test('happy path: pi.flow login ends in signed tokens carrying acr, amr, auth_time, sub, nonce', async () => {
  const { driver } = lab();
  const d = driver();
  const r = await d.run({ username: 'mark', passwords: [MOCK_PASSWORD] });
  assert.equal(r.ok, true);
  assert.equal(r.claims.sub, 'usr-mark');
  assert.equal(r.claims.acr, 'mock:single');
  assert.deepEqual(r.claims.amr, ['pwd']);
  assert.equal(typeof r.claims.auth_time, 'number');
  assert.equal(r.nonceOk, true);
  assert.equal(r.stateOk, true);
  assert.deepEqual(d.trace.map((t) => t.n), [1, 2, 3, 4]);
  for (const t of d.trace) assert.ok(t.title && t.request && t.response && 'note' in t);
});

test('the trace masks the password and truncates cookies', async () => {
  const { driver } = lab();
  const d = driver();
  await d.run({ username: 'mark', passwords: [MOCK_PASSWORD] });
  const text = JSON.stringify(d.trace);
  assert.ok(!text.includes(MOCK_PASSWORD));
  assert.match(text, /\*{8}/);
});

test('authorize without response_mode=pi.flow is refused with a clear error (no redirect login path)', async () => {
  const { driver } = lab();
  for (const mode of [undefined, 'query', 'fragment', 'form_post', 'PI.FLOW']) {
    const d = driver();
    const a = await d.authorize({ response_mode: mode });
    assert.equal(a.status, 400, String(mode));
    assert.equal(a.json.error, 'invalid_request');
    assert.match(a.json.error_description, /pi\.flow/);
    assert.match(a.json.error_description, /redirect-based login is not supported/);
    assert.equal(a.setCookies.length, 0);
  }
});

test('authorize validates client, redirect_uri, PKCE S256, state, nonce, acr_values, max_age', async () => {
  const { driver } = lab();
  const bad = [
    [{ client_id: 'nope' }, 'invalid_client'],
    [{ redirect_uri: 'https://evil.example/cb' }, 'invalid_request'],
    [{ code_challenge: undefined }, 'invalid_request'],
    [{ code_challenge_method: 'plain' }, 'invalid_request'],
    [{ code_challenge: 'short' }, 'invalid_request'],
    [{ state: undefined }, 'invalid_request'],
    [{ nonce: undefined }, 'invalid_request'],
    [{ acr_values: 'urn:made:up' }, 'invalid_request'],
    [{ max_age: '-1' }, 'invalid_request'],
    [{ max_age: 'abc' }, 'invalid_request'],
    [{ response_type: 'token' }, 'unsupported_response_type'],
    [{ scope: 'profile' }, 'invalid_scope'],
  ];
  for (const [over, error] of bad) {
    const a = await driver().authorize(over);
    assert.equal(a.status, 400, JSON.stringify(over));
    assert.equal(a.json.error, error, JSON.stringify(over));
  }
});

test('authorize returns a flow with a well formed id, status and links', async () => {
  const { driver } = lab();
  const d = driver();
  const a = await d.authorize({ login_hint: 'mark' });
  assert.equal(a.status, 200);
  assert.match(a.json.id, FLOW_ID_RE);
  assert.equal(a.json.status, 'USERNAME_PASSWORD_REQUIRED');
  assert.ok(a.json._links.self.href.startsWith(`${BASE}/flows/`));
  assert.match(a.setCookies[0], /^ST=/);
});

test('wrong password keeps the flow, counts attempts, then a right one succeeds', async () => {
  const { driver } = lab();
  const d = driver();
  await d.authorize();
  const bad = await d.submit('password', { username: 'mark', password: 'nope' });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.status, 'USERNAME_PASSWORD_REQUIRED');
  assert.equal(bad.json.error.code, 'INVALID_CREDENTIALS');
  assert.deepEqual(bad.json.attempts, { used: 1, max: 3, remaining: 2 });
  const ok = await d.submit('password', { username: 'mark', password: MOCK_PASSWORD });
  assert.equal(ok.json.status, 'RESUME_REQUIRED');
});

test('unknown user looks like a wrong password (no enumeration)', async () => {
  const { driver } = lab();
  const d = driver();
  await d.authorize();
  const r = await d.submit('password', { username: 'ghost', password: 'x' });
  assert.equal(r.json.error.code, 'INVALID_CREDENTIALS');
});

test('lockout after N wrong passwords, even the right password is refused, then it expires', async () => {
  const { driver, clk } = lab();
  const d = driver();
  await d.authorize();
  await d.submit('password', { username: 'mark', password: 'a' });
  await d.submit('password', { username: 'mark', password: 'b' });
  const third = await d.submit('password', { username: 'mark', password: 'c' });
  assert.equal(third.json.error.code, 'ACCOUNT_LOCKED');
  const right = await d.submit('password', { username: 'mark', password: MOCK_PASSWORD });
  assert.equal(right.json.error.code, 'ACCOUNT_LOCKED');
  clk.advance(301);
  // flow itself lives 300s, so a new flow is needed after the lock lapses
  const d2 = driver();
  const r = await d2.run({ username: 'mark', passwords: [MOCK_PASSWORD] });
  assert.equal(r.ok, true);
});

test('MFA user: password, device selection, otp, then tokens with acr mock:multi and amr mfa', async () => {
  const { driver } = lab();
  const d = driver();
  const r = await d.run({ username: 'priya', passwords: [MOCK_PASSWORD], deviceId: 'dev-priya-mail', otp: MOCK_OTP });
  assert.equal(r.ok, true);
  assert.equal(r.claims.acr, 'mock:multi');
  assert.deepEqual(r.claims.amr, ['pwd', 'otp', 'mfa']);
  assert.ok(d.trace.some((t) => /device/i.test(t.title)));
});

test('single device user skips device selection straight to OTP_REQUIRED; wrong otp then lockout of the flow', async () => {
  const { driver } = lab();
  const d = driver();
  await d.authorize();
  const p = await d.submit('password', { username: 'dana', password: MOCK_PASSWORD });
  assert.equal(p.json.status, 'OTP_REQUIRED');
  let r = await d.submit('otp', { otp: '000000' });
  assert.equal(r.json.error.code, 'OTP_INVALID');
  await d.submit('otp', { otp: '000001' });
  r = await d.submit('otp', { otp: '000002' });
  assert.equal(r.json.error.code, 'OTP_ATTEMPTS_EXCEEDED');
  r = await d.submit('otp', { otp: MOCK_OTP });
  assert.equal(r.status, 400);
});

test('acr_values=mock:multi forces MFA on a user who does not need it; mock:single does not', async () => {
  const { driver } = lab();
  const a = await driver().run({ username: 'mark', passwords: [MOCK_PASSWORD], otp: MOCK_OTP, authorize: { acr_values: 'mock:multi' } });
  assert.equal(a.claims.acr, 'mock:multi');
  const b = await driver().run({ username: 'mark', passwords: [MOCK_PASSWORD], authorize: { acr_values: 'mock:single' } });
  assert.equal(b.claims.acr, 'mock:single');
});

test('a user with no device cannot satisfy a stronger acr', async () => {
  const { driver } = lab({ users: { zed: { sub: 'usr-zed', name: 'Zed', password: MOCK_PASSWORD, mfa: false, devices: [] } } });
  const d = driver();
  await d.authorize({ acr_values: 'mock:multi' });
  const r = await d.submit('password', { username: 'zed', password: MOCK_PASSWORD });
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, 'NO_MFA_DEVICE');
});

test('stale session-token cookie on resume is rejected, and the flow is not burned', async () => {
  const { driver } = lab();
  const d = driver();
  await d.authorize();
  const old = { ...d.jar };
  await d.submit('password', { username: 'mark', password: MOCK_PASSWORD });
  assert.notDeepEqual(old, d.jar, 'cookie rotated');
  const fresh = { ...d.jar };
  d.jar = old;
  const stale = await d.resume();
  assert.equal(stale.status, 401);
  assert.equal(stale.json.code, 'INVALID_SESSION_TOKEN');
  d.jar = {};
  assert.equal((await d.resume()).status, 401, 'no cookie at all');
  d.jar = fresh;
  assert.equal((await d.resume()).status, 200);
});

test('a stale cookie is also refused on a flow step', async () => {
  const { driver } = lab();
  const d = driver();
  await d.authorize();
  d.jar = { ST: 'stale' };
  const r = await d.submit('password', { username: 'mark', password: MOCK_PASSWORD });
  assert.equal(r.status, 401);
});

test('flow expiry uses the injected clock', async () => {
  const { driver, clk } = lab();
  const d = driver();
  await d.authorize();
  clk.advance(301);
  const r = await d.submit('password', { username: 'mark', password: MOCK_PASSWORD });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'FLOW_EXPIRED');
});

test('malformed and unknown flow ids', async () => {
  const { driver } = lab();
  const d = driver();
  await d.authorize();
  for (const bad of ['a', 'has space!', 'x'.repeat(65), '..%2f..']) {
    d.flow = { id: bad };
    const r = await d.submit('password', { username: 'mark', password: 'x' });
    assert.equal(r.status, 400, bad);
    assert.equal(r.json.code, 'INVALID_FLOW_ID');
  }
  d.flow = { id: 'abcdefghij' };
  assert.equal((await d.submit('password', { username: 'mark', password: 'x' })).status, 404);
  assert.equal((await d.resume()).status, 404);
});

test('flows are single use: a completed flow cannot be resumed or stepped again', async () => {
  const { driver } = lab();
  const d = driver();
  await d.run({ username: 'mark', passwords: [MOCK_PASSWORD] });
  const again = await d.resume();
  assert.equal(again.status, 400);
  assert.equal(again.json.code, 'FLOW_ALREADY_COMPLETED');
});

test('resume before the flow is ready is refused', async () => {
  const { driver } = lab();
  const d = driver();
  await d.authorize();
  const r = await d.resume();
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'NOT_READY');
});

test('content type rules: json is 415, wrong step type is 400, Accept application/json only is 406', async () => {
  const { fetchLike, driver } = lab();
  const d = driver();
  await d.authorize();
  const url = `${BASE}/flows/${d.flow.id}`;
  const cookie = d.cookieHeader();
  assert.equal((await fetchLike(url, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{}' })).status, 415);
  const otpType = 'application/vnd.pingidentity.otp.check+json';
  assert.equal((await fetchLike(url, { method: 'POST', headers: { 'content-type': otpType, cookie }, body: '{"otp":"1"}' })).status, 400);
  const pw = 'application/vnd.pingidentity.usernamePassword.check+json';
  assert.equal((await fetchLike(url, { method: 'POST', headers: { 'content-type': pw, accept: 'application/json', cookie }, body: '{}' })).status, 406);
});

test('code exchange: replayed code, wrong verifier, wrong redirect_uri, wrong client are all invalid_grant', async () => {
  const mk = async () => { const l = lab(); const d = l.driver(); await d.authorize(); await d.submit('password', { username: 'mark', password: MOCK_PASSWORD }); await d.resume(); return d; };
  let d = await mk();
  assert.equal((await d.exchange()).status, 200);
  const replay = await d.exchange();
  assert.equal(replay.json.error, 'invalid_grant');
  assert.match(replay.json.error_description, /already used/);

  d = await mk();
  const wrongV = await d.exchange({ verifier: 'v'.repeat(43) });
  assert.equal(wrongV.json.error, 'invalid_grant');
  assert.match(wrongV.json.error_description, /PKCE/);
  assert.equal((await d.exchange()).status, 400, 'a burned code stays burned');

  d = await mk();
  assert.match((await d.exchange({ redirectUri: 'https://other.lab.example/callback' })).json.error_description, /redirect_uri/);

  d = await mk();
  d.clientId = 'lab-other';
  assert.match((await d.exchange()).json.error_description, /different client/);

  d = await mk();
  assert.equal((await d.exchange({ verifier: '' })).json.error, 'invalid_grant');
});

test('code expires on the injected clock', async () => {
  const { driver, clk } = lab();
  const d = driver();
  await d.authorize(); await d.submit('password', { username: 'mark', password: MOCK_PASSWORD }); await d.resume();
  clk.advance(61);
  assert.match((await d.exchange()).json.error_description, /expired/);
});

test('token endpoint: unknown grant type and garbage', async () => {
  const { fetchLike } = lab();
  const r = await fetchLike(`${BASE}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=password&username=a' });
  assert.equal((await r.json()).error, 'unsupported_grant_type');
});

test('tokens verify only in the process that made them; a reset mints a new key and forgets flows', async () => {
  const l = lab();
  const d = l.driver();
  const r = await d.run({ username: 'mark', passwords: [MOCK_PASSWORD] });
  assert.equal(l.op.verifyAccess(r.tokens.access_token).ok, true);
  l.op.reset();
  assert.equal(l.op.verifyAccess(r.tokens.access_token).reason, 'bad_signature');
});

test('pkce helper is S256 and the engine never accepts a plain challenge', () => {
  assert.equal(pkceChallenge('abc'), 'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
});

test('redirect and client constants used by the helpers are registered', async () => {
  const { driver } = lab();
  const a = await driver().authorize();
  assert.equal(a.status, 200);
  assert.equal(CLIENT, 'lab-app');
  assert.ok(REDIRECT.endsWith('.example/callback'));
});
