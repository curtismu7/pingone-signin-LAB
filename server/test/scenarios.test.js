import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, VERTICALS, storyCorpus, renderScenario } from '../src/stories.js';
import { IMPLS } from '../src/scenarios.js';
import { runScenario, runAll, matches } from '../src/runner.js';
import { scanHosts } from '../src/safety.js';

test('every scenario has an implementation and every implementation a scenario', () => {
  assert.deepEqual([...SCENARIOS.map((s) => s.slug)].sort(), Object.keys(IMPLS).sort());
  assert.ok(SCENARIOS.length >= 15);
  assert.equal(new Set(SCENARIOS.map((s) => s.id)).size, SCENARIOS.length);
});

for (const v of VERTICALS) {
  test(`every scenario behaves as written in the ${v.id} vertical`, async () => {
    const results = await runAll(v.id);
    for (const r of results) {
      assert.equal(r.pass, true, `${r.id} ${r.slug}: expected ${JSON.stringify(r.expected)} got ${JSON.stringify(r.actual)} ${r.error || ''}`);
      assert.ok(r.trace.length >= 1, r.id);
      assert.deepEqual(r.trace.map((t) => t.n), r.trace.map((_t, i) => i + 1));
      assert.ok(!/\{\{/.test(r.title + r.takeaway), 'no unrendered cast token');
    }
  });
}

test('required scenario kinds are all present', () => {
  const slugs = SCENARIOS.map((s) => s.slug);
  for (const want of ['happy-path', 'wrong-password-then-success', 'lockout', 'stale-cookie-resume', 'expired-flow', 'replayed-code', 'wrong-verifier', 'redirect-login-refused', 'step-up-low-acr', 'max-age-stale', 'ciba-approve', 'ciba-deny', 'ciba-expire', 'ciba-slow-down', 'ciba-binding-too-long']) assert.ok(slugs.includes(want), want);
});

test('matches compares every expected key', () => {
  assert.equal(matches({ a: 1 }, { a: 1, b: 2 }), true);
  assert.equal(matches({ a: 1 }, { a: 2 }), false);
  assert.equal(matches({ a: 1 }, {}), false);
});

test('a scenario whose actual differs from the data file reports pass:false', async () => {
  const s = SCENARIOS.find((x) => x.slug === 'happy-path');
  const old = s.expect.acr; s.expect.acr = 'mock:multi';
  try { assert.equal((await runScenario('happy-path')).pass, false); } finally { s.expect.acr = old; }
});

test('runScenario rejects unknown ids and verticals; scenario runs are isolated from each other', async () => {
  await assert.rejects(runScenario('nope'), /unknown scenario/);
  await assert.rejects(runScenario('S01', 'nope'), /unknown vertical/);
  const a = await runScenario('lockout'); const b = await runScenario('happy-path');
  assert.equal(a.pass && b.pass, true, 'lockout in one run does not lock the user in the next');
});

test('the story corpus has only reserved hosts, and the scanner catches a real one', () => {
  for (const { where, text } of storyCorpus()) assert.deepEqual(scanHosts(text), [], where);
  assert.deepEqual(scanHosts('https://login.realcorp.com/x'), ['login.realcorp.com']);
});

test('titles render cast names', () => {
  assert.match(renderScenario(SCENARIOS[0], VERTICALS[0]).title, /Mark Ellison/);
});

test('redirect-login scenario and every trace never contain the mock password', async () => {
  for (const r of await runAll('travel')) assert.ok(!JSON.stringify(r.trace).includes('mock-password'), r.id);
});
