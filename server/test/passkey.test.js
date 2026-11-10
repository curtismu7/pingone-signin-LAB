import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer, rawHttp } from './helpers.js';
import { createSoftAuthenticator } from '../../core/test/softAuthenticator.js';

// The mock RP over HTTP: the RP origin and RP ID come from the page's (same-origin) Origin header.
const TP = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
const post = (base, path, body, headers = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, traceparent: TP, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

async function ceremony(base, authr = createSoftAuthenticator(), username = 'mark') {
  const ro = await (await post(base, '/mock/passkey/register/options', { username })).json();
  const reg = await (await post(base, '/mock/passkey/register/verify', authr.create(ro.publicKey, base))).json();
  const lo = await (await post(base, '/mock/passkey/login/options', { username })).json();
  const assertion = authr.get(lo.publicKey, base);
  const res = await post(base, '/mock/passkey/login/verify', assertion);
  return { ro, reg, lo, assertion, res, body: await res.json(), authr };
}

test('passkey over HTTP: options carry the RP ID of the page origin; register then sign in verifies; the trace records it', async () => {
  await withServer(async (base) => {
    const { ro, reg, res, body } = await ceremony(base);
    assert.equal(ro.publicKey.rp.id, '127.0.0.1');
    assert.equal(ro.expectedOrigin, base);
    assert.equal(reg.ok, true, JSON.stringify(reg.steps.filter((s) => !s.ok)));
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.user, 'mark');
    assert.match(res.headers.get('traceparent'), /^00-0af7651916cd43dd8448eb211c80319c-[0-9a-f]{16}-01$/);
    const creds = await (await fetch(`${base}/mock/passkey/credentials`)).json();
    assert.equal(creds.mock, true);
    assert.equal(creds.credentials.length, 1);
    assert.equal(creds.credentials[0].signCount, 1);
    const trace = await (await fetch(`${base}/api/trace`)).json();
    assert.ok(trace.entries.some((e) => e.source === 'passkey' && e.path === '/passkey/login/verify' && e.status === 200));
  });
});

test('a refused verification is a 400 with the failed step named; a replayed assertion is refused', async () => {
  await withServer(async (base) => {
    const { assertion } = await ceremony(base);
    const again = await post(base, '/mock/passkey/login/verify', assertion);
    assert.equal(again.status, 400);
    const b = await again.json();
    assert.equal(b.ok, false);
    assert.equal(b.steps.find((s) => s.id === 'challenge').ok, false);
    assert.equal(b.steps.find((s) => s.id === 'signCount').ok, false);
  });
});

test('origin binding: a ceremony started on localhost cannot be finished with a 127.0.0.1 origin in clientDataJSON', async () => {
  await withServer(async (base) => {
    const port = new URL(base).port;
    const local = `http://localhost:${port}`;
    const authr = createSoftAuthenticator();
    const raw = await rawHttp(`${base}/mock/passkey/register/options`, { method: 'POST', headers: { host: `localhost:${port}`, origin: local, 'content-type': 'application/json' }, body: JSON.stringify({ username: 'mark' }) });
    assert.equal(raw.status, 200);
    const ro = JSON.parse(raw.text);
    assert.equal(ro.publicKey.rp.id, 'localhost');
    const r = await (await post(base, '/mock/passkey/register/verify', authr.create(ro.publicKey, base))).json();
    assert.equal(r.ok, false);
    assert.deepEqual(r.steps.filter((s) => !s.ok).map((s) => s.id), ['origin']);
  });
});

test('passkey routes keep the safety rules: Host check, same-origin writes, body limits, bad input is a clean 400', async () => {
  await withServer(async (base) => {
    assert.equal((await rawHttp(`${base}/mock/passkey/credentials`, { headers: { host: 'evil.example.invalid' } })).status, 403);
    assert.equal((await post(base, '/mock/passkey/register/options', { username: 'mark' }, { origin: 'http://evil.example.invalid' })).status, 403);
    assert.equal((await post(base, '/mock/passkey/login/options', {}, { 'sec-fetch-site': 'cross-site' })).status, 403);
    const unknown = await post(base, '/mock/passkey/register/options', { username: '<script>' });
    assert.equal(unknown.status, 400);
    assert.match((await unknown.json()).message, /mock cast/);
    assert.equal((await post(base, '/mock/passkey/register/verify', '{bad json')).status, 400);
    assert.equal((await post(base, '/mock/passkey/login/verify', { type: 'public-key', response: { clientDataJSON: 'A'.repeat(40_000) } })).status, 413);
    const junk = await post(base, '/mock/passkey/login/verify', { nope: 1 });
    assert.equal(junk.status, 400);
    assert.equal((await junk.json()).ok, false);
    assert.equal((await fetch(`${base}/mock/passkey/nope`)).status, 404);
    // the pi.flow mock is still reachable behind the passkey router
    assert.equal((await fetch(`${base}/mock/authorize`)).status, 400);
  });
});

test('POST /api/reset forgets passkeys and challenges', async () => {
  await withServer(async (base) => {
    const { lo, authr } = await ceremony(base);
    assert.equal((await post(base, '/api/reset', {})).status, 200);
    assert.equal((await (await fetch(`${base}/mock/passkey/credentials`)).json()).credentials.length, 0);
    const r = await (await post(base, '/mock/passkey/login/verify', authr.get(lo.publicKey, base))).json();
    assert.equal(r.ok, false);
    assert.equal(r.steps.find((s) => s.id === 'credential').ok, false);
  });
});
