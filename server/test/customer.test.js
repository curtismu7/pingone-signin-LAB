import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMockOP, parseTraceparent } from 'pingone-piflow-core';
import { createApp, startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { validateCustomerConfig, isPurple, contrast, loadCustomerConfig, MAX_BYTES, textDepth, depthOf } from '../src/customerConfig.js';
import { runChecks } from '../src/doctor.js';
import { renderScenario, SCENARIOS, VERTICALS, undefinedTokens, tokensIn } from '../src/stories.js';

const ok = (raw) => { const r = validateCustomerConfig(raw, { verticals: VERTICALS.map((v) => v.id) }); assert.deepEqual(r.errors, []); return r.config; };
const errs = (raw) => validateCustomerConfig(raw, { verticals: VERTICALS.map((v) => v.id) }).errors;

test('customer.config: a valid file is sanitized and gets computed on-colours', () => {
  const c = ok({ name: ' Contoso Air ', vertical: 'travel', vocabulary: { action: 'seat change' }, brand: { primary: '#0B6BCB' } });
  assert.equal(c.name, 'Contoso Air');
  assert.equal(c.brand.primary, '#0b6bcb');
  assert.match(c.brand.onPrimary, /^#/);
  assert.ok(contrast(c.brand.primary, c.brand.onPrimary) >= 4.5);
  assert.ok(contrast(c.brand.primaryDark, c.brand.onPrimaryDark) >= 4.5);
  assert.deepEqual(ok({}), {});
});

test('customer.config: bad shapes, unknown fields, credentials, markup, purple and low contrast are all refused', () => {
  assert.match(errs([])[0], /JSON object/);
  assert.ok(errs({ extra: 1 }).some((e) => /unknown field/.test(e)));
  assert.ok(errs({ name: '' }).length && errs({ name: 'x'.repeat(41) }).length && errs({ name: '<b>x</b>' }).length && errs({ name: 5 }).length);
  assert.ok(errs({ vertical: 'nope' }).some((e) => /vertical/.test(e)));
  assert.ok(errs({ vocabulary: { 'Bad Key': 'x' } }).length && errs({ vocabulary: { ok: 'a\nb' } }).length && errs({ vocabulary: [] }).length);
  assert.ok(errs({ brand: { primary: 'red' } }).length && errs({ brand: { primary: '#fff' } }).length && errs({ brand: { accent: '#112233' } }).length);
  for (const purple of ['#7a2bd6', '#6a1b9a', '#9c27b0', '#b01fa0', '#5b3fd1']) assert.ok(errs({ brand: { primary: purple } }).some((e) => /purple/.test(e)), purple);
  assert.equal(isPurple('#b3122c'), false); assert.equal(isPurple('#0b6bcb'), false); assert.equal(isPurple('#17702f'), false); assert.equal(isPurple('#808080'), false);
  assert.ok(errs({ brand: { primary: '#f5f5a0' } }).some((e) => /too light/.test(e)));
  assert.ok(errs({ brand: { primary: '#b3122c', primaryDark: '#101010' } }).some((e) => /too dark/.test(e)));
  for (const k of ['apiKey', 'client_secret', 'password', 'accessToken']) assert.ok(errs({ vocabulary: { [k]: 'x' } }).some((e) => /credential/.test(e)) || errs({ [k]: 'x' }).some((e) => /credential/.test(e)), k);
});

test('customer.config: the file is read, re-read on change, and a bad file is reported, never thrown', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-'));
  const file = path.join(dir, 'customer.config.json');
  assert.deepEqual(loadCustomerConfig({ file }), { config: {}, errors: [], file, present: false });
  fs.writeFileSync(file, JSON.stringify({ name: 'Acme' }));
  assert.equal(loadCustomerConfig({ file }).config.name, 'Acme');
  fs.writeFileSync(file, JSON.stringify({ name: 'Acme Two' }));
  assert.equal(loadCustomerConfig({ file }).config.name, 'Acme Two');
  fs.writeFileSync(file, '{ not json');
  const bad = loadCustomerConfig({ file });
  assert.ok(bad.errors.length && bad.present && Object.keys(bad.config).length === 0);
});

test('customer.config reaches the API: name, vocabulary and default vertical change the stories; the doctor flags a bad file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-'));
  const file = path.join(dir, 'c.json');
  fs.writeFileSync(file, JSON.stringify({ name: 'Contoso Bank', vertical: 'banking', vocabulary: { action: 'wire' }, brand: { primary: '#0b6bcb' } }));
  const health = createHealth({ intervalMs: 3_600_000 }); await health.ready;
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health, op: createMockOP(), webDist: '/nonexistent', customerFile: file }) });
  const base = url.replace(/\/$/, '');
  try {
    const cat = await (await fetch(`${base}/api/catalog`)).json();
    assert.equal(cat.vertical, 'banking');
    assert.equal(cat.customer.name, 'Contoso Bank');
    assert.equal(cat.vocab.org, 'Contoso Bank');
    assert.equal(cat.vocab.action, 'wire');
    assert.match(cat.scenarios.find((s) => s.id === 'S09').title, /wire asks for more/);
    assert.match(cat.scenarios.find((s) => s.id === 'S01').title, /Contoso Bank/);
    const cc = await (await fetch(`${base}/api/customer-config`)).json();
    assert.deepEqual([cc.present, cc.valid], [true, true]);
    assert.equal(JSON.stringify(cc).match(/secret|password/i), null);
    assert.equal((await (await fetch(`${base}/api/catalog?vertical=travel`)).json()).vertical, 'travel');
    const run = await (await fetch(`${base}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario: 'S09' }) })).json();
    assert.match(run.title, /wire asks for more/);
    assert.equal(run.vertical, 'banking');
  } finally { health.stop(); await new Promise((r) => server.close(r)); }
  fs.writeFileSync(file, JSON.stringify({ brand: { primary: '#7a2bd6' } }));
  const checks = await runChecks({ env: {}, customerFile: file });
  assert.equal(checks.find((c) => c.id === 'customer-config').level, 'fail');
  assert.match(checks.find((c) => c.id === 'customer-config').detail, /purple/);
  assert.equal((await runChecks({ env: {} })).find((c) => c.id === 'customer-config').level, 'pass');
});

test('three vertical packs, every story token is defined in every vertical, and an undefined token is caught', () => {
  assert.equal(VERTICALS.length, 3);
  assert.deepEqual(VERTICALS.map((v) => v.id), ['travel', 'banking', 'healthcare']);
  const roles = Object.keys(VERTICALS[0].cast).sort(); const words = Object.keys(VERTICALS[0].vocab).sort();
  for (const v of VERTICALS) { assert.deepEqual(Object.keys(v.cast).sort(), roles, v.id); assert.deepEqual(Object.keys(v.vocab).sort(), words, v.id); }
  const used = new Set();
  for (const s of SCENARIOS) for (const t of tokensIn(`${s.title} ${s.takeaway}`)) used.add(t);
  assert.ok([...used].some((t) => t.startsWith('cast.')) && [...used].some((t) => t.startsWith('vocab.')));
  for (const v of VERTICALS) {
    for (const s of SCENARIOS) {
      assert.deepEqual(undefinedTokens(`${s.title} ${s.takeaway}`, v), [], `${s.id}/${v.id}`);
      const r = renderScenario(s, v);
      assert.ok(!/\{\{|\}\}/.test(r.title + r.takeaway), `${s.id}/${v.id} renders without braces`);
    }
  }
  // the check itself bites
  assert.deepEqual(undefinedTokens('{{cast.nobody}} and {{vocab.zzz}} and {{plain}} and {{cast.plain}}', VERTICALS[0]), ['cast.nobody', 'vocab.zzz', 'plain']);
  assert.deepEqual(undefinedTokens('{{vocab.zzz}}', VERTICALS[0], { vocabulary: { zzz: 'x' } }), []);
  assert.deepEqual(undefinedTokens('{{__proto__}} {{constructor}}', VERTICALS[0]), ['__proto__', 'constructor']);
});

test('the three packs differ: names and words change the rendered story', () => {
  const titles = VERTICALS.map((v) => renderScenario(SCENARIOS.find((s) => s.id === 'S09'), v).title);
  assert.equal(new Set(titles).size, 3);
  assert.match(titles[2], /prescription refill/);
});

test('the mock route sends a traceparent with the same trace id and records the hop in the sink', async () => {
  const health = createHealth({ intervalMs: 3_600_000 }); await health.ready;
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health, op: createMockOP(), webDist: '/nonexistent' }) });
  const base = url.replace(/\/$/, '');
  try {
    const tp = `00-${'a1'.repeat(16)}-${'b2'.repeat(8)}-01`;
    const r = await fetch(`${base}/mock/nope`, { headers: { traceparent: tp } });
    const back = parseTraceparent(r.headers.get('traceparent'));
    assert.equal(back.traceId, 'a1'.repeat(16));
    assert.notEqual(back.spanId, 'b2'.repeat(8));
    assert.equal((await fetch(`${base}/mock/nope`, { headers: { traceparent: 'junk' } })).headers.get('traceparent'), null);
    const { entries } = await (await fetch(`${base}/api/trace`)).json();
    assert.equal(entries[0].traceparent, tp);
    assert.equal(entries[0].replyTraceparent, r.headers.get('traceparent'));
    assert.equal(entries[1].traceparent, null, 'a malformed traceparent is not recorded');
    const run = await (await fetch(`${base}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario: 'S11' }) })).json();
    const ids = new Set(run.trace.map((e) => parseTraceparent(e.request.headers.traceparent)?.traceId));
    assert.equal(ids.size, 1);
    assert.ok(run.trace.every((e) => parseTraceparent(e.request.headers.traceparent) && parseTraceparent(e.response.headers.traceparent)), 'every hop of a scenario carries a traceparent both ways');
  } finally { health.stop(); await new Promise((r) => server.close(r)); }
});

test('customer.config caps: file bytes, vocabulary words, lengths, nesting, top-level fields; each gives a clear error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-'));
  const load = (text, name = 'c.json') => { const f = path.join(dir, name); fs.writeFileSync(f, text); return loadCustomerConfig({ file: f }); };
  // 2.9 MB with 200k vocabulary keys: refused by size before it is parsed
  const huge = JSON.stringify({ vocabulary: Object.fromEntries(Array.from({ length: 200_000 }, (_, i) => [`k${i}`, 'v'])) });
  assert.ok(huge.length > 2_000_000);
  let r = load(huge, 'huge.json');
  assert.match(r.errors[0], new RegExp(`larger than ${MAX_BYTES} bytes`)); assert.deepEqual(r.config, {});
  // under the byte cap but over the word cap
  const many = (n) => JSON.stringify({ vocabulary: Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, 'v'])) });
  assert.ok(many(51).length < MAX_BYTES);
  assert.match(load(many(51), 'many.json').errors[0], /more than 50 words/);
  assert.deepEqual(load(many(50), 'fifty.json').errors, []);
  assert.equal(Object.keys(load(many(50), 'fifty2.json').config.vocabulary).length, 50);
  // lengths
  assert.ok(errs({ vocabulary: { a: 'x'.repeat(41) } }).some((e) => /1-40/.test(e)));
  assert.ok(errs({ vocabulary: { ['k'.repeat(22)]: 'x' } }).some((e) => /camelCase/.test(e)));
  assert.ok(errs({ name: 'x'.repeat(41) }).length);
  // nesting: raw text (no parse, so no stack overflow) and a parsed object
  const deep = '['.repeat(200_000) + ']'.repeat(200_000);
  assert.ok(deep.length > MAX_BYTES * 3, 'bigger than the byte cap, so test the depth check on a smaller one too');
  const smallDeep = '['.repeat(5000) + ']'.repeat(5000);
  r = load(smallDeep, 'deep.json');
  assert.match(r.errors[0], /nested deeper than 6 levels/); assert.ok(!/not valid JSON/.test(r.errors[0]));
  assert.match(load('{"name":"x","brand":{"a":{"b":{"c":{"d":{"e":{"f":1}}}}}}}', 'deep2.json').errors[0], /nested deeper/);
  assert.equal(textDepth('{"a":"[[[[[[[[["}'), 1, 'brackets inside strings do not count');
  assert.equal(depthOf({ a: [{ b: [1] }] }), 4);
  assert.match(errs(JSON.parse('{"x":{"x":{"x":{"x":{"x":{"x":{"x":1}}}}}}}'))[0], /nested deeper/);
  assert.match(errs(Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`f${i}`, 1])))[0], /more than 20 top-level/);
  // a real stack overflow is not reported as invalid JSON
  const sample = load('{ not json', 'bad.json'); assert.match(sample.errors[0], /not valid JSON/);
  // doctor reports each as a failure with the reason
});

test('the doctor fails on an oversize customer.config and says why', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-'));
  const f = path.join(dir, 'big.json');
  fs.writeFileSync(f, JSON.stringify({ vocabulary: Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${i}`, 'value'])) }));
  const c = (await runChecks({ env: {}, customerFile: f })).find((x) => x.id === 'customer-config');
  assert.equal(c.level, 'fail'); assert.match(c.detail, /larger than/);
});

test('indigo is refused as purple; the house blues, teals and greens are accepted', () => {
  for (const c of ['#3a3adb', '#4b3fd1', '#3f2fd0', '#5a4bdc', '#4040e0']) assert.equal(isPurple(c), true, c);
  for (const c of ['#0b6bcb', '#0060ff', '#1a6fd0', '#0b5a66', '#008080', '#17702f', '#b3122c', '#e07000', '#2a7de1']) assert.equal(isPurple(c), false, c);
  assert.ok(errs({ brand: { primary: '#3a3adb' } }).some((e) => /purple/.test(e)));
});
