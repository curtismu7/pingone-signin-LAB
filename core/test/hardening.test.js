import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { lab, BASE, MOCK_PASSWORD, MOCK_OTP } from './helpers.js';
import { createMockOP, createInProcessFetch, signJwt, decodeJwt, callResource, pkceChallenge, MT } from '../src/index.js';

const CH = pkceChallenge('v'.repeat(43));
const q = (over = {}) => ({ client_id: 'lab-app', redirect_uri: 'https://app.lab.example/callback', response_type: 'code', scope: 'openid', response_mode: 'pi.flow', code_challenge: CH, code_challenge_method: 'S256', state: 's', nonce: 'n', ...over });

test('handle() never throws: odd inputs give a JSON answer', () => {
  const op = createMockOP();
  for (const req of [{}, { path: '/flows/%zz' }, { path: '/flows/%' }, { path: '/flows/%E0%A4%A', method: 'POST' }, { method: 'POST', path: '/token', body: null }, { path: '/authorize', query: null }, { path: '/as/resume', query: { flowId: ['a', 'b'] } }, { path: '/as/resume', query: { flowId: {} } }, { path: '/as/resume', query: null }]) {
    const r = op.handle(req);
    assert.ok(r.status >= 200 && r.status < 600 && r.body, JSON.stringify(req));
  }
});

test('a malformed percent-escape in the flow path is a 400 INVALID_FLOW_ID, not a crash', () => {
  const op = createMockOP();
  for (const path of ['/flows/%zz', '/flows/%', '/flows/%E0%A4%A']) for (const method of ['GET', 'POST']) {
    const r = op.handle({ method, path, headers: { 'content-type': MT.password }, body: {} });
    assert.equal(r.status, 400, `${method} ${path}`);
    assert.equal(r.body.code, 'INVALID_FLOW_ID');
  }
});

test('array-valued or nested authorize parameters are refused, never opened', () => {
  const op = createMockOP();
  for (const over of [{ scope: ['openid'] }, { code_challenge: [CH] }, { acr_values: ['mock:multi'] }, { state: ['a', 'b'] }, { nonce: ['n'] }, { login_hint: ['mark'] }, { max_age: ['5'] }, { client_id: ['lab-app'] }, { redirect_uri: ['https://app.lab.example/callback'] }, { scope: { 0: 'openid' } }]) {
    const r = op.handle({ method: 'GET', path: '/authorize', query: q(over) });
    assert.equal(r.status, 400, JSON.stringify(over));
    assert.equal(r.body.error, 'invalid_request', JSON.stringify(over));
    assert.equal(r.headers['set-cookie'], undefined, 'no flow, no cookie');
  }
  assert.equal(op.handle({ method: 'GET', path: '/authorize', query: q() }).status, 200, 'control: the plain request opens a flow');
});

test('array-valued token and bc-authorize parameters are refused', () => {
  const op = createMockOP();
  assert.equal(op.handle({ method: 'POST', path: '/token', body: { grant_type: 'authorization_code', code: ['x'], client_id: 'lab-app' } }).body.error, 'invalid_request');
  assert.equal(op.handle({ method: 'POST', path: '/bc-authorize', body: { client_id: 'lab-app', scope: ['openid'], login_hint: 'mark' } }).body.error, 'invalid_request');
});

test('object-prototype names are not clients, users, codes or requests', async () => {
  const l = lab();
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const a = await l.driver().authorize({ client_id: name });
    assert.equal(a.status, 400, name); assert.equal(a.json.error, 'invalid_client');
    const d = l.driver(); await d.authorize();
    const p = await d.submit('password', { username: name, password: MOCK_PASSWORD });
    assert.equal(p.status, 400); assert.equal(p.json.details[0].code, 'INVALID_CREDENTIALS');
    const c = l.ciba();
    assert.equal((await c.start({ loginHint: name })).json.error, 'unknown_user_id', name);
    c.clientId = name;
    assert.equal((await c.start({ loginHint: 'mark' })).json.error, 'invalid_client', name);
    const t = await l.fetchLike(`${BASE}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `grant_type=authorization_code&code=${name}&client_id=lab-app` });
    assert.equal((await t.json()).error, 'invalid_grant');
    const tc = await l.fetchLike(`${BASE}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn:openid:params:grant-type:ciba&auth_req_id=${name}&client_id=lab-app` });
    assert.equal((await tc.json()).error, 'invalid_grant');
  }
});

test('resource server checks aud, iss, alg and typ even when the signature is good', async () => {
  const l = lab();
  const a = await l.driver().run({ username: 'dana', passwords: [MOCK_PASSWORD], otp: MOCK_OTP });
  const key = l.op._state().key;
  const good = decodeJwt(a.tokens.access_token).payload;
  const t = l.driver().tracer;
  assert.equal((await callResource(t, BASE, signJwt(good, key, 'at+jwt'), { path: '/rs/balance', method: 'GET' })).status, 200, 'control: re-signed with the right key and claims');
  for (const [label, token] of [
    ['wrong aud', signJwt({ ...good, aud: 'https://other.mock.example/x' }, key, 'at+jwt')],
    ['wrong iss', signJwt({ ...good, iss: 'https://evil.mock.example' }, key, 'at+jwt')],
    ['wrong typ', signJwt(good, key, 'JWT')],
  ]) {
    const r = await callResource(t, BASE, token, { path: '/rs/balance', method: 'GET' });
    assert.equal(r.status, 401, label); assert.equal(r.json.error, 'invalid_token', label);
  }
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = `${b64({ alg: 'HS512', typ: 'at+jwt' })}.${b64(good)}`;
  const hs512 = `${input}.${createHmac('sha512', key).update(input).digest('base64url')}`;
  const r = await callResource(t, BASE, hs512, { path: '/rs/balance', method: 'GET' });
  assert.equal(r.status, 401);
  assert.match(r.json.error_description, /bad_alg/);
});

test('the trace shortens cookies in requests and set-cookie, and never holds a full session token', async () => {
  const l = lab();
  const d = l.driver();
  await d.run({ username: 'mark', passwords: [MOCK_PASSWORD] });
  const text = JSON.stringify(d.trace);
  assert.ok(d.trace.some((t) => t.request.headers.cookie), 'a request carried a cookie');
  for (const t of d.trace) {
    if (t.request.headers.cookie) assert.match(t.request.headers.cookie, /^ST=.{6}…$/);
    for (const c of t.response.headers['set-cookie'] || []) assert.match(c, /^ST=.{6}…;/);
  }
  const full = [...text.matchAll(/ST=([A-Za-z0-9_-]{15,})/g)];
  assert.deepEqual(full, []);
});

test('transport: a foreign origin or path outside the mock prefix is a 404, and the body is capped', async () => {
  const op = createMockOP();
  const f = createInProcessFetch(op, { baseUrl: 'https://mock-op.example/mock' });
  assert.equal((await f('https://elsewhere.example/mock/authorize')).status, 404);
  assert.equal((await f('https://mock-op.example/other/authorize')).status, 404);
  assert.equal((await f('https://mock-op.example/mockery/authorize')).status, 404);
  assert.equal((await f('https://mock-op.example/abcd/authorize')).status, 404, 'same length as the prefix, different name');
  assert.equal((await f('https://mock-op.example/mock/authorize')).status, 400, 'control: reaches the mock');
  const l = lab();
  const d = l.driver(); await d.authorize();
  const big = JSON.stringify({ username: 'mark', password: MOCK_PASSWORD, pad: 'x'.repeat(9000) });
  const r = await l.fetchLike(`${BASE}/flows/${d.flow.id}`, { method: 'POST', headers: { 'content-type': MT.password, cookie: d.cookieHeader() }, body: big });
  assert.equal(r.status, 400, 'a body over 8192 characters is cut, so it cannot parse');
});

test('handle() turns an internal throw into a JSON 500', () => {
  const op = createMockOP();
  const r = op.handle({ method: 'GET', path: '/authorize', get query() { throw new Error('boom'); } });
  assert.equal(r.status, 500);
  assert.equal(r.body.code, 'INTERNAL_ERROR');
});

test('the lockout table is bounded', async () => {
  const l = lab({ config: { maxLockEntries: 5, maxAttempts: 99 } });
  const d = l.driver(); await d.authorize();
  for (let i = 0; i < 20; i++) await d.submit('password', { username: `ghost${i}`, password: 'x' });
  assert.ok(l.op._state().locks.size <= 5, String(l.op._state().locks.size));
});
