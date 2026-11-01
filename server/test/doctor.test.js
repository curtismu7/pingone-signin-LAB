import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { runChecks, allPassed } from '../src/doctor.js';

const byId = (cs, id) => cs.find((c) => c.id === id);

test('doctor passes on a clean default environment and covers every check', async () => {
  const cs = await runChecks({ env: {} });
  assert.ok(allPassed(cs), JSON.stringify(cs.filter((c) => c.level === 'fail')));
  assert.deepEqual(cs.map((c) => c.id), ['node', 'bind', 'port-range', 'workspace', 'customer-config', 'story-tokens', 'story-hosts', 'netguard', 'pi-flow-only', 'scenarios', 'web-dist']);
});

test('web-dist is info (not a failure) when the UI is not built, pass when it is', async () => {
  const missing = byId(await runChecks({ env: {}, webDist: '/nonexistent-web-dist' }), 'web-dist');
  assert.equal(missing.level, 'info');
  assert.match(missing.detail, /npm run build/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
  assert.equal(byId(await runChecks({ env: {}, webDist: dir }), 'web-dist').level, 'pass');
  assert.ok(allPassed(await runChecks({ env: {}, webDist: '/nonexistent-web-dist' })));
});

test('doctor fails a port outside 6100-6199 and a non-loopback bind without opt-in', async () => {
  assert.equal(byId(await runChecks({ env: { PORT: '4771' } }), 'port-range').level, 'fail');
  assert.equal(byId(await runChecks({ env: { PORT: '6200' } }), 'port-range').level, 'fail');
  assert.equal(byId(await runChecks({ env: { SIGNIN_BIND: '0.0.0.0' } }), 'bind').level, 'pass');
});

test('pi-flow-only fails if authorize issues a cookie, answers 200, or loses the pi.flow message', async () => {
  const wrap = (fn) => () => ({ handle: fn });
  const refusal = { status: 400, headers: {}, body: { error: 'invalid_request', error_description: 'send response_mode=pi.flow' } };
  assert.equal(byId(await runChecks({ env: {}, makeOp: wrap(() => refusal) }), 'pi-flow-only').level, 'pass');
  assert.equal(byId(await runChecks({ env: {}, makeOp: wrap(() => ({ ...refusal, headers: { 'set-cookie': ['ST=x'] } })) }), 'pi-flow-only').level, 'fail');
  assert.equal(byId(await runChecks({ env: {}, makeOp: wrap(() => ({ status: 200, headers: {}, body: { error_description: 'pi.flow' } })) }), 'pi-flow-only').level, 'fail');
  assert.equal(byId(await runChecks({ env: {}, makeOp: wrap(() => ({ ...refusal, body: { error_description: 'nope' } })) }), 'pi-flow-only').level, 'fail');
  assert.equal(byId(await runChecks({ env: {}, makeOp: wrap(() => { throw new Error('boom'); }) }), 'pi-flow-only').level, 'fail');
});

test('doctor: node needs 26 or later', async () => {
  const major = Number(process.versions.node.split('.')[0]);
  assert.equal(byId(await runChecks({ env: {} }), 'node').level, major >= 26 ? 'pass' : 'fail');
  assert.match(byId(await runChecks({ env: {} }), 'node').detail, /need >= 26/);
});

test('doctor: no mode, hosted or k8s checks exist (Docker only, mock only)', async () => {
  const ids = (await runChecks({ env: { MODE: 'live', SIGNIN_HOSTED: '1' } })).map((c) => c.id);
  for (const gone of ['mode', 'hosted', 'k8s-manifests']) assert.ok(!ids.includes(gone), gone);
});
