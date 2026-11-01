import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMockOP } from 'pingone-piflow-core';
import { createApp, startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { resolveWorkspace, validWorkspaceId, createTraceSink, workspaceDir } from '../src/workspace.js';

async function boot(opts = {}) {
  const health = createHealth({ intervalMs: 3_600_000 }); await health.ready;
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health, webDist: '/nonexistent-web-dist', ...opts }) });
  return { base: url.replace(/\/$/, ''), stop: async () => { health.stop(); await new Promise((r) => server.close(r)); } };
}
const CH = '7w_YNF9DSfIdPf_pRjSq646_kPr-2-o9NAl16JGghdM';
const authorize = (base, extra = {}) => fetch(`${base}/mock/authorize?${new URLSearchParams({ client_id: 'lab-app', redirect_uri: 'https://app.lab.example/callback', response_type: 'code', scope: 'openid', response_mode: 'pi.flow', code_challenge: CH, code_challenge_method: 'S256', state: 's', nonce: 'n', ...extra })}`);
const post = (base, p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('workspace ids: default, validated as [a-z0-9-]{1,32}', () => {
  assert.equal(resolveWorkspace({}), 'default');
  assert.equal(resolveWorkspace({ SIGNIN_WORKSPACE: '' }), 'default');
  assert.equal(resolveWorkspace({ SIGNIN_WORKSPACE: 'acme-2' }), 'acme-2');
  for (const bad of ['Acme', 'a_b', 'a b', '../x', 'a/b', '', 'x'.repeat(33), '.hidden']) { assert.equal(validWorkspaceId(bad), false, bad); }
  for (const bad of ['Acme', '../x', 'x'.repeat(33)]) assert.throws(() => resolveWorkspace({ SIGNIN_WORKSPACE: bad }), /SIGNIN_WORKSPACE/);
  assert.equal(validWorkspaceId('x'.repeat(32)), true);
  assert.throws(() => workspaceDir('/r', '../x'), /bad workspace id/);
});

test('two workspaces share nothing: flows, codes, lockouts, the trace sink and the reset', async () => {
  const a = await boot({ workspace: 'alpha' }); const b = await boot({ workspace: 'beta' });
  try {
    assert.equal((await (await fetch(`${a.base}/api/workspace`)).json()).workspace, 'alpha');
    assert.equal((await (await fetch(`${b.base}/api/catalog`)).json()).workspace, 'beta');
    // a flow opened in alpha does not exist in beta
    const fa = await (await authorize(a.base)).json();
    const inBeta = await fetch(`${b.base}/mock/flows/${fa.id}`);
    assert.equal(inBeta.status, 404);
    // a lockout in alpha does not lock the same user in beta
    const attempt = async (base, pw) => {
      const o = await authorize(base);
      const f = await o.json();
      const cookie = o.headers.getSetCookie()[0].split(';')[0];
      const r = await fetch(`${base}/mock/flows/${f.id}`, { method: 'POST', headers: { 'content-type': 'application/vnd.pingidentity.usernamePassword.check+json', cookie }, body: JSON.stringify({ username: 'mark', password: pw }) });
      return (await r.json());
    };
    for (let i = 0; i < 3; i++) await attempt(a.base, 'wrong');
    assert.equal((await attempt(a.base, 'mock-password')).error.code, 'ACCOUNT_LOCKED', 'alpha: locked even with the right password');
    assert.equal((await attempt(b.base, 'mock-password')).status, 'RESUME_REQUIRED', 'beta: mark signs in normally');
    assert.ok((await (await post(a.base, '/api/run', { scenario: 'lockout' })).json()).pass);
    // the trace sinks are separate
    const ta = (await (await fetch(`${a.base}/api/trace`)).json());
    const tb = (await (await fetch(`${b.base}/api/trace`)).json());
    assert.equal(ta.workspace, 'alpha'); assert.equal(tb.workspace, 'beta');
    assert.ok(ta.entries.length > 0);
    assert.ok(ta.entries.some((e) => e.source === 'scenario'));
    assert.ok(tb.entries.length > 0 && tb.entries.every((e) => e.workspace === 'beta' && e.source === 'mock'));
    assert.ok(ta.entries.every((e) => e.workspace === 'alpha'));
    // beta's mock still works from a clean state, and resetting beta leaves alpha's flow and sink alone
    const fb = await (await authorize(b.base)).json();
    assert.notEqual(fb.id, fa.id);
    assert.equal((await post(b.base, '/api/reset', {})).status, 200);
    assert.equal((await fetch(`${a.base}/mock/flows/${fa.id}`)).status, 401, 'alpha still knows its flow (401: no cookie sent, not 404)');
    assert.ok((await (await fetch(`${a.base}/api/trace`)).json()).entries.length > 0);
    // and resetting alpha empties alpha's sink and forgets its flow
    assert.equal((await post(a.base, '/api/reset', {})).status, 200);
    assert.equal((await (await fetch(`${a.base}/api/trace`)).json()).entries.length, 0);
    assert.equal((await fetch(`${a.base}/mock/flows/${fa.id}`)).status, 404);
  } finally { await a.stop(); await b.stop(); }
});

test('data directories are per workspace: the sink writes <root>/<id>/trace.jsonl and nowhere else', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  const a = await boot({ workspace: 'one', dataRoot: root }); const b = await boot({ workspace: 'two', dataRoot: root });
  try {
    await authorize(a.base); await authorize(a.base); await authorize(b.base);
    assert.deepEqual(fs.readdirSync(root).sort(), ['one', 'two']);
    const lines = (id) => fs.readFileSync(path.join(root, id, 'trace.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines('one').length, 2);
    assert.equal(lines('two').length, 1);
    assert.ok(lines('one').every((r) => r.workspace === 'one' && !('cookie' in r) && !/\?/.test(r.path)));
  } finally { await a.stop(); await b.stop(); }
});

test('a request cannot choose the workspace: headers and query strings are ignored', async () => {
  const a = await boot({ workspace: 'alpha' });
  try {
    const r = await fetch(`${a.base}/api/workspace?workspace=evil`, { headers: { 'x-workspace': 'evil', 'x-signin-workspace': 'evil' } });
    assert.equal((await r.json()).workspace, 'alpha');
  } finally { await a.stop(); }
});

test('the trace sink is bounded and never throws on a bad directory', () => {
  const s = createTraceSink({ workspace: 'x', max: 3 });
  for (let i = 0; i < 10; i++) s.record({ i });
  assert.deepEqual(s.list().map((r) => r.i), [7, 8, 9]);
  const bad = createTraceSink({ workspace: 'x', dir: '/dev/null/nope' });
  assert.doesNotThrow(() => bad.record({ a: 1 }));
  assert.equal(bad.list().length, 1);
});

test('the trace file stops growing at its cap (memory keeps the last entries), and a bad workspace id is refused even with no data directory', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-'));
  const s = createTraceSink({ workspace: 'cap', dir, max: 5, maxFileBytes: 2000 });
  for (let i = 0; i < 100; i++) s.record({ i, pad: 'x'.repeat(40) });
  const file = path.join(dir, 'trace.jsonl');
  assert.ok(fs.statSync(file).size <= 2000);
  assert.ok(fs.statSync(file).size > 1500);
  assert.equal(s.fileFull, true);
  assert.deepEqual(s.list().map((r) => r.i), [95, 96, 97, 98, 99]);
  // an existing big file counts too
  const s2 = createTraceSink({ workspace: 'cap', dir, maxFileBytes: 2000 });
  s2.record({ again: 1 });
  assert.ok(fs.statSync(file).size <= 2000);
  for (const bad of ['../x', 'Up', '', 'a b']) {
    assert.throws(() => createApp({ workspace: bad, webDist: '/nonexistent' }), /bad workspace id/, bad);
    assert.throws(() => createTraceSink({ workspace: bad }), /bad workspace id/);
  }
  assert.doesNotThrow(() => createApp({ workspace: 'fine-1', webDist: '/nonexistent' }));
});
