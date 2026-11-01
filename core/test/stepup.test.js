import test from 'node:test';
import assert from 'node:assert/strict';
import { lab, MOCK_PASSWORD, MOCK_OTP, BASE } from './helpers.js';
import { buildChallenge, parseChallenge, stepUpNeeded, callResource, signJwt, decodeJwt } from '../src/index.js';

test('buildChallenge and parseChallenge round trip, including quotes and multiple acr values', () => {
  const h = buildChallenge({ acrValues: ['mock:multi', 'mock:hw'], maxAge: 300, description: 'say "hi", \\ ok' });
  assert.match(h, /^Bearer error="insufficient_user_authentication"/);
  const p = parseChallenge(h);
  assert.deepEqual(p.acr_values, ['mock:multi', 'mock:hw']);
  assert.equal(p.max_age, 300);
  assert.equal(p.error_description, 'say "hi", \\ ok');
  assert.equal(parseChallenge('Basic realm="x"'), null);
  assert.equal(parseChallenge('Bearer realm="x"'), null);
  assert.equal(parseChallenge(''), null);
  assert.equal(parseChallenge(buildChallenge({ maxAge: 0 })).max_age, 0);
});

test('control characters are stripped from a challenge value', () => {
  assert.ok(!/[\r\n]/.test(buildChallenge({ description: 'a\r\nSet-Cookie: x' })));
});

test('stepUpNeeded reports only the failing parts', () => {
  const o = { requireAcr: 'mock:multi', maxAgeS: 300, nowMs: 1_000_000 * 1000 };
  assert.equal(stepUpNeeded({ acr: 'mock:multi', auth_time: 999_900 }, o), null);
  assert.deepEqual(Object.keys(stepUpNeeded({ acr: 'mock:single', auth_time: 999_900 }, o)).sort(), ['acrValues', 'description']);
  assert.deepEqual(Object.keys(stepUpNeeded({ acr: 'mock:multi', auth_time: 100 }, o)).sort(), ['description', 'maxAge']);
  assert.ok(stepUpNeeded({}, o).acrValues);
});

test('an inherited object key is not an acr: constructor, __proto__ and toString are below mock:single', () => {
  const o = { requireAcr: 'mock:multi', maxAgeS: 300, nowMs: 1_000_000 };
  for (const acr of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const r = stepUpNeeded({ acr, auth_time: 999_900 }, o);
    assert.ok(r && r.acrValues?.[0] === 'mock:multi', `${acr} must not satisfy mock:multi`);
  }
  assert.equal(stepUpNeeded({ acr: 'mock:single', auth_time: 999_900 }, { ...o, requireAcr: 'mock:single' }), null);
});

test('step-up: low acr gets a 401 challenge, re-authorize with acr_values gets a 200', async () => {
  const l = lab();
  const first = await l.driver().run({ username: 'mark', passwords: [MOCK_PASSWORD] });
  const t = l.driver().tracer;
  const denied = await callResource(t, BASE, first.tokens.access_token);
  assert.equal(denied.status, 401);
  assert.equal(denied.challenge.error, 'insufficient_user_authentication');
  assert.deepEqual(denied.challenge.acr_values, ['mock:multi']);
  assert.equal(denied.challenge.max_age, undefined);
  const second = await l.driver().run({ username: 'mark', passwords: [MOCK_PASSWORD], otp: MOCK_OTP, authorize: { acr_values: denied.challenge.acr_values.join(' ') } });
  assert.equal(second.claims.acr, 'mock:multi');
  const ok = await callResource(t, BASE, second.tokens.access_token);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.transferred, true);
});

test('step-up: stale auth_time gets a max_age challenge; fresh login gets a 200', async () => {
  const l = lab();
  const a = await l.driver().run({ username: 'dana', passwords: [MOCK_PASSWORD], otp: MOCK_OTP });
  const t = l.driver().tracer;
  assert.equal((await callResource(t, BASE, a.tokens.access_token)).status, 200);
  l.clk.advance(301);
  const stale = await callResource(t, BASE, a.tokens.access_token);
  assert.equal(stale.status, 401);
  assert.equal(stale.challenge.max_age, 300);
  assert.equal(stale.challenge.acr_values, undefined);
  const b = await l.driver().run({ username: 'dana', passwords: [MOCK_PASSWORD], otp: MOCK_OTP, authorize: { max_age: String(stale.challenge.max_age) } });
  assert.ok(b.claims.auth_time > a.claims.auth_time);
  assert.equal((await callResource(t, BASE, b.tokens.access_token)).status, 200);
});

test('resource server refuses missing, forged, id and unsigned tokens, and an expired one', async () => {
  const l = lab();
  const a = await l.driver().run({ username: 'dana', passwords: [MOCK_PASSWORD], otp: MOCK_OTP });
  const t = l.driver().tracer;
  const none = await l.fetchLike(`${BASE}/rs/transfer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(none.status, 401);
  assert.equal((await callResource(t, BASE, 'not.a.jwt')).status, 401);
  const forged = signJwt({ ...decodeJwt(a.tokens.access_token).payload }, Buffer.alloc(32, 1), 'at+jwt');
  assert.equal((await callResource(t, BASE, forged)).json.error, 'invalid_token');
  assert.equal((await callResource(t, BASE, a.tokens.id_token)).json.error, 'invalid_token');
  const p = a.tokens.access_token.split('.')[1];
  const unsigned = `${Buffer.from('{"alg":"none","typ":"at+jwt"}').toString('base64url')}.${p}.`;
  assert.equal((await callResource(t, BASE, unsigned)).json.error, 'invalid_token');
  l.clk.advance(901);
  assert.match((await callResource(t, BASE, a.tokens.access_token)).json.error_description, /expired/);
});

test('rs: balance needs only a valid token; transfer validates its body after the policy', async () => {
  const l = lab();
  const a = await l.driver().run({ username: 'dana', passwords: [MOCK_PASSWORD], otp: MOCK_OTP });
  const t = l.driver().tracer;
  assert.equal((await callResource(t, BASE, a.tokens.access_token, { path: '/rs/balance', method: 'GET' })).status, 200);
  assert.equal((await callResource(t, BASE, a.tokens.access_token, { body: { amount: -1, to: 'x' } })).status, 400);
});
