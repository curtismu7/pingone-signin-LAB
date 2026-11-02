import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createApp, startHttpServer, previewCookie } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { withServer, rawHttp } from './helpers.js';

const j = (r) => r.json();

test('GET /api/health is demo-health/1 for pingone-signin-lab, GET only, no extra fields', async () => {
  await withServer(async (base) => {
    const body = await j(await fetch(`${base}/api/health`));
    assert.equal(body.schema, 'demo-health/1');
    assert.equal(body.state, 'ready');
    assert.equal(body.runtime, 'offline');
    assert.equal(body.demo.id, 'pingone-signin-lab');
    assert.deepEqual(Object.keys(body).sort(), ['at', 'demo', 'runtime', 'schema', 'state']);
    const post = await fetch(`${base}/api/health`, { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET');
  });
});

test('Host header must be loopback; same-origin writes only', async () => {
  await withServer(async (base) => {
    assert.equal((await rawHttp(`${base}/api/health`, { headers: { host: 'evil.example.invalid' } })).status, 403);
    assert.equal((await rawHttp(`${base}/mock/authorize`, { headers: { host: 'evil.example.invalid' } })).status, 403);
    const cross = await fetch(`${base}/api/reset`, { method: 'POST', headers: { origin: 'http://evil.example.invalid', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(cross.status, 403);
    const crossMock = await fetch(`${base}/mock/token`, { method: 'POST', headers: { origin: 'http://evil.example.invalid', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(crossMock.status, 403);
    assert.equal((await fetch(`${base}/api/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 200);
  });
});

test('catalog, scenarios list, run, run-all', async () => {
  await withServer(async (base) => {
    const cat = await j(await fetch(`${base}/api/catalog`));
    assert.equal(cat.mock, true);
    assert.equal(cat.vertical, 'travel');
    assert.ok(cat.scenarios.length >= 15);
    assert.deepEqual(cat.acr.values, ['mock:single', 'mock:multi']);
    assert.match(cat.acr.note, /UNVERIFIED/);
    assert.equal((await j(await fetch(`${base}/api/catalog?vertical=banking`))).vertical, 'banking');
    assert.equal((await fetch(`${base}/api/catalog?vertical=zzz`)).status, 400);
    const list = await j(await fetch(`${base}/api/scenarios`));
    assert.equal(list.scenarios.length, cat.scenarios.length);

    const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const run = await j(await post('/api/run', { scenario: 'lockout' }));
    assert.equal(run.pass, true);
    assert.ok(run.trace.length > 3);
    assert.ok('expected' in run && 'actual' in run);
    assert.equal((await post('/api/run', { scenario: 'nope' })).status, 400);
    assert.equal((await post('/api/run', {})).status, 400);
    const all = await j(await post('/api/run-all', { vertical: 'banking' }));
    assert.equal(all.passed, all.total);
    assert.equal((await post('/api/run-all', { vertical: 'x' })).status, 400);
  });
});

test('echoed input is inert and malformed JSON is a clean 400', async () => {
  await withServer(async (base) => {
    const r = await fetch(`${base}/api/catalog?vertical=${encodeURIComponent('a‮b\u0000')}`);
    assert.equal(r.status, 400);
    const text = await r.text();
    assert.ok(!text.includes('‮'));
    const bad = await fetch(`${base}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
    assert.equal(bad.status, 400);
    assert.ok(!(await bad.text()).includes('at '), 'no stack trace');
    assert.equal((await fetch(`${base}/api/nope`)).status, 404);
  });
});

test('safety-scan reports clean', async () => {
  await withServer(async (base) => {
    const s = await j(await fetch(`${base}/api/safety-scan`));
    assert.equal(s.clean, true);
    assert.deepEqual(s.findings, []);
  });
});

// Hand-driven login against the live mock over real loopback HTTP, with a hand-rolled cookie jar.
test('live /mock: pi.flow login over HTTP, cookie rotation, redirect refusal, replay', async () => {
  await withServer(async (base) => {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({ client_id: 'lab-app', redirect_uri: 'https://app.lab.example/callback', response_type: 'code', scope: 'openid', response_mode: 'pi.flow', code_challenge: challenge, code_challenge_method: 'S256', state: 'st-1', nonce: 'no-1' });

    const redirect = new URLSearchParams(q); redirect.delete('response_mode');
    const refused = await fetch(`${base}/mock/authorize?${redirect}`, { redirect: 'manual' });
    assert.equal(refused.status, 400);
    assert.equal(refused.headers.get('location'), null);
    assert.equal(refused.headers.get('set-cookie'), null);
    assert.match((await j(refused)).error_description, /pi\.flow/);

    const open = await fetch(`${base}/mock/authorize?${q}`);
    assert.equal(open.status, 200);
    let cookie = /^(ST=[^;]+)/.exec(open.headers.get('set-cookie'))[1];
    const flow = await j(open);
    assert.ok(flow._links.self.href.startsWith(`${base}/mock/flows/`));

    const pw = await fetch(flow._links.self.href, { method: 'POST', headers: { 'content-type': 'application/vnd.pingidentity.usernamePassword.check+json', cookie }, body: JSON.stringify({ username: 'mark', password: 'mock-password' }) });
    assert.equal(pw.status, 200);
    const old = cookie;
    cookie = /^(ST=[^;]+)/.exec(pw.headers.get('set-cookie'))[1];
    assert.notEqual(cookie, old);
    const step = await j(pw);
    assert.equal(step.status, 'COMPLETED');
    assert.ok(step.resumeUrl.startsWith(`${base}/mock/as/resume?flowId=`));

    assert.equal((await fetch(step.resumeUrl, { headers: { cookie: old } })).status, 401);
    const resumed = await j(await fetch(step.resumeUrl, { headers: { cookie } }));
    assert.equal(resumed.authorizeResponse.state, 'st-1');

    const tok = (code, v) => fetch(`${base}/mock/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: v, redirect_uri: 'https://app.lab.example/callback', client_id: 'lab-app' }) });
    const ok = await tok(resumed.authorizeResponse.code, verifier);
    assert.equal(ok.status, 200);
    const tokens = await j(ok);
    const claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url'));
    assert.equal(claims.nonce, 'no-1');
    assert.equal((await tok(resumed.authorizeResponse.code, verifier)).status, 400);

    const rs = await fetch(`${base}/mock/rs/transfer`, { method: 'POST', headers: { authorization: `Bearer ${tokens.access_token}`, 'content-type': 'application/json' }, body: '{"amount":5,"to":"x"}' });
    assert.equal(rs.status, 401);
    assert.match(rs.headers.get('www-authenticate'), /insufficient_user_authentication.*acr_values="mock:multi"/);

    // reset forgets everything
    await fetch(`${base}/api/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal((await fetch(`${base}/mock/rs/balance`, { headers: { authorization: `Bearer ${tokens.access_token}` } })).status, 401);
  });
});

test('live /mock: CIBA over HTTP and unknown paths', async () => {
  await withServer(async (base) => {
    const form = (o) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o) });
    const started = await j(await fetch(`${base}/mock/bc-authorize`, form({ client_id: 'lab-app', scope: 'openid', login_hint: 'mark', binding_message: 'AB12' })));
    const poll = () => fetch(`${base}/mock/token`, form({ grant_type: 'urn:openid:params:grant-type:ciba', auth_req_id: started.auth_req_id, client_id: 'lab-app' }));
    assert.equal((await j(await poll())).error, 'authorization_pending');
    await fetch(`${base}/mock/phone/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ auth_req_id: started.auth_req_id }) });
    assert.equal((await j(await poll())).error, 'slow_down');
    assert.equal((await fetch(`${base}/mock/nothing`)).status, 404);
    const tooLong = await fetch(`${base}/mock/bc-authorize`, form({ client_id: 'lab-app', scope: 'openid', login_hint: 'mark', binding_message: '123456789' }));
    assert.equal((await j(tooLong)).error, 'invalid_binding_message');
  });
});

test('an oversize POST body is a 413 on /mock and on /api', async () => {
  await withServer(async (base) => {
    const big = JSON.stringify({ pad: 'x'.repeat(9000) });
    for (const path of ['/api/run', '/mock/token']) {
      const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: big });
      assert.equal(r.status, 413, path);
    }
    const form = await fetch(`${base}/mock/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `pad=${'x'.repeat(9000)}` });
    assert.equal(form.status, 413);
  });
});

test('live /mock: percent-escape and array-valued query cases are clean 4xx, not 500', async () => {
  await withServer(async (base) => {
    for (const bad of ['%zz', '%']) assert.equal((await fetch(`${base}/mock/flows/${bad}`)).status, 400, bad);
    const url = `${base}/mock/authorize?client_id=lab-app&redirect_uri=https://app.lab.example/callback&response_type=code&response_mode=pi.flow&scope[]=openid&code_challenge=7w_YNF9DSfIdPf_pRjSq646_kPr-2-o9NAl16JGghdM&code_challenge_method=S256&state=s&nonce=n`;
    const r = await fetch(url);
    assert.equal(r.status, 400);
    assert.equal(r.headers.get('set-cookie'), null);
    const dup = await fetch(`${base}/mock/authorize?response_mode=pi.flow&client_id=lab-app&client_id=lab-other`);
    assert.equal(dup.status, 400);
    assert.equal((await fetch(`${base}/mock/authorize?client_id=constructor&response_mode=pi.flow`)).status, 400);
  });
});

test('the built web UI is served at / with a CSP and an SPA fallback, and never shadows /api or /mock', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webdist-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>ui</title>');
  fs.mkdirSync(path.join(dir, 'assets')); fs.writeFileSync(path.join(dir, 'assets/a.js'), 'x=1');
  const health = createHealth({ intervalMs: 3_600_000 }); await health.ready;
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health, webDist: dir }) });
  const base = url.replace(/\/$/, '');
  try {
    const root = await fetch(`${base}/`);
    assert.equal(root.status, 200);
    assert.match(root.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(root.headers.get('content-security-policy'), /connect-src 'self'/);
    assert.match(await root.text(), /<title>ui<\/title>/);
    assert.equal(await (await fetch(`${base}/assets/a.js`)).text(), 'x=1');
    assert.match(await (await fetch(`${base}/some/deep/route`)).text(), /<title>ui<\/title>/);
    for (const p of ['/api/unknown', '/mock/unknown', '/api/', '/mock/']) {
      const r = await fetch(`${base}${p}`);
      assert.equal(r.status, 404, p);
      assert.match(r.headers.get('content-type'), /json/, `${p} must be the API's JSON 404, not the UI page`);
      assert.doesNotMatch(await r.text(), /<title>ui<\/title>/, p);
    }
    for (const p of ['/assets/nope.js', '/favicon.ico', '/nope.css']) {
      const r = await fetch(`${base}${p}`);
      assert.equal(r.status, 404, p);
      assert.doesNotMatch(await r.text(), /<title>ui<\/title>/, `${p} must not be answered with the HTML page`);
    }
    assert.equal((await rawHttp(`${base}/`, { headers: { host: 'evil.example.invalid' } })).status, 403);
  } finally { health.stop(); await new Promise((r) => server.close(r)); }
});

test('without a web build, / is a plain 404 and the API still works', async () => {
  const health = createHealth({ intervalMs: 3_600_000 }); await health.ready;
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health, webDist: '/nonexistent-web-dist' }) });
  const base = url.replace(/\/$/, '');
  try {
    assert.equal((await fetch(`${base}/`)).status, 404);
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
  } finally { health.stop(); await new Promise((r) => server.close(r)); }
});

test('the mock sends a shortened, ASCII-only preview of the rotating session-token cookie for the UI', async () => {
  await withServer(async (base) => {
    const q = new URLSearchParams({ client_id: 'lab-app', redirect_uri: 'https://app.lab.example/callback', response_type: 'code', scope: 'openid', response_mode: 'pi.flow', code_challenge: '7w_YNF9DSfIdPf_pRjSq646_kPr-2-o9NAl16JGghdM', code_challenge_method: 'S256', state: 's', nonce: 'n' });
    const r = await fetch(`${base}/mock/authorize?${q}`);
    const full = r.headers.getSetCookie()[0].split(';')[0].split('=')[1];
    const preview = r.headers.get('x-mock-cookie-preview');
    assert.match(preview, /^ST=[A-Za-z0-9_-]{6}\.\.\.$/);
    assert.ok(!preview.includes(full));
    assert.ok(full.startsWith(preview.slice(3, 9)));
    assert.equal((await fetch(`${base}/mock/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).headers.get('x-mock-cookie-preview'), null);
  });
});

test('previewCookie always shortens: 6 characters and dots, or full masking when the value is short', () => {
  assert.equal(previewCookie('ST=abcdefghijkl; Path=/'), 'ST=abcdef...');
  assert.equal(previewCookie('ST=abcdefg'), 'ST=abcdef...');
  assert.equal(previewCookie('ST=abcdef'), 'ST=***...');
  assert.equal(previewCookie('ST=ab'), 'ST=***...');
  assert.equal(previewCookie('ST='), 'ST=***...');
  for (const v of ['x', 'abcdef', 'abcdefghijklmnop']) assert.ok(!previewCookie(`ST=${v}`).includes(v) || v.length > 6, v);
});
