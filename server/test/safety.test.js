import test from 'node:test';
import assert from 'node:assert/strict';
import { inert, isLoopbackHost, assertBindAllowed, bindHost, portProblem, resolvePort, isReservedHost, scanHosts, hostCheck, sameOriginWrites } from '../src/safety.js';

test('loopback names', () => {
  for (const h of ['localhost', '127.0.0.1', '127.9.9.9', '::1', '[::1]']) assert.ok(isLoopbackHost(h), h);
  for (const h of ['127.999.1.1', '127.0.0.256', '0.0.0.0', '192.168.1.5', 'example.com', 'localhost.evil.invalid']) assert.ok(!isLoopbackHost(h), h);
});

test('bind: loopback only unless SIGNIN_BIND is set', () => {
  assert.equal(bindHost({}), '127.0.0.1');
  assert.throws(() => assertBindAllowed('0.0.0.0', {}), /loopback only/);
  assert.equal(assertBindAllowed('127.0.0.1', {}), '127.0.0.1');
  assert.equal(assertBindAllowed('0.0.0.0', { SIGNIN_BIND: '0.0.0.0' }), '0.0.0.0');
});

test('ports: 6100-6199 only', () => {
  assert.equal(portProblem(6171), null);
  assert.equal(portProblem(6100), null); assert.equal(portProblem(6199), null);
  for (const p of [8080, 5173, 4771, 6099, 6200, 3000]) assert.ok(portProblem(p), String(p));
  assert.ok(portProblem(NaN));
  assert.equal(resolvePort({}), 6171);
  assert.equal(resolvePort({ PORT: '6180' }), 6180);
  assert.throws(() => resolvePort({ PORT: '6200' }));
});

test('reserved hosts and the host scan', () => {
  assert.ok(isReservedHost('a.b.invalid')); assert.ok(isReservedHost('example.com')); assert.ok(!isReservedHost('sub.example.com'));
  assert.deepEqual(scanHosts('https://as.example.invalid/x and mail a@example.org and http://localhost:6171/'), []);
  assert.deepEqual(scanHosts('see https://real.com/x and 10.1.2.3'), ['10.1.2.3', 'real.com']);
});

const run = (mw, req) => { const out = {}; const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } }; mw(req, res, () => { out.next = true; }); return out; };

test('hostCheck refuses a non-loopback Host (DNS rebinding)', () => {
  assert.ok(run(hostCheck, { headers: { host: 'localhost:6171' } }).next);
  assert.ok(run(hostCheck, { headers: { host: '[::1]:6171' } }).next);
  assert.equal(run(hostCheck, { headers: { host: 'evil.example.invalid:6171' } }).status, 403);
  assert.equal(run(hostCheck, { headers: {} }).status, 403);
});

test('sameOriginWrites: GET passes, cross-origin and cross-site writes refused', () => {
  const h = { host: 'localhost:6171' };
  assert.ok(run(sameOriginWrites, { method: 'GET', headers: { ...h, origin: 'http://evil.example.invalid' } }).next);
  assert.ok(run(sameOriginWrites, { method: 'POST', headers: h }).next, 'no Origin (curl) is allowed');
  assert.ok(run(sameOriginWrites, { method: 'POST', headers: { ...h, origin: 'http://localhost:6171' } }).next);
  assert.equal(run(sameOriginWrites, { method: 'POST', headers: { ...h, origin: 'http://localhost:9999' } }).status, 403);
  assert.equal(run(sameOriginWrites, { method: 'POST', headers: { ...h, origin: 'null' } }).status, 403);
  assert.equal(run(sameOriginWrites, { method: 'DELETE', headers: { ...h, 'sec-fetch-site': 'cross-site' } }).status, 403);
  assert.ok(run(sameOriginWrites, { method: 'POST', headers: { ...h, 'sec-fetch-site': 'same-origin' } }).next);
});

test('inert makes control and bidi characters visible and caps the length', () => {
  assert.equal(inert('a\u0000b\n\u202ec'), 'a\\u0000b\\u000a\\u202ec');
  assert.equal(inert('x'.repeat(500)).length, 120);
});

import { makeSameOriginWrites, parseHostHeader, makeHostCheck } from '../src/safety.js';

test('Host header parsing is strict and hostCheck is loopback only', () => {
  assert.equal(parseHostHeader('Lab.Example:6171'), 'lab.example');
  assert.equal(parseHostHeader('[::1]:80'), '[::1]');
  for (const bad of ['', 'a b', 'a:b', 'a:0', 'a:65536', 'a:1:2', 'a@b', 'a/b', 'a,b', undefined]) assert.equal(parseHostHeader(bad), null, String(bad));
  const hc = makeHostCheck();
  assert.ok(run(hc, { headers: { host: 'localhost:6171' } }).next);
  assert.ok(run(hc, { headers: { host: '127.0.0.1:6171' } }).next);
  assert.equal(run(hc, { headers: { host: 'lab.example' } }).status, 403);
  assert.equal(run(hostCheck, { headers: { host: 'lab.example' } }).status, 403, 'the default check is loopback only');
  assert.equal(run(hc, { headers: { host: 'localhost', 'x-forwarded-host': 'lab.example' } }).next, true, 'X-Forwarded-* is never read');
  assert.equal(run(hc, { headers: { host: 'x', 'x-forwarded-host': 'localhost' } }).status, 403);
});

test('same-origin writes: the Origin must match the Host; a cross-origin Origin is refused', () => {
  const mw = makeSameOriginWrites();
  const post = (host, origin) => run(mw, { method: 'POST', headers: { host, origin } });
  assert.ok(post('localhost:6171', 'http://localhost:6171').next);
  assert.equal(post('localhost:6171', 'http://evil.invalid').status, 403);
  assert.equal(post('localhost:6171', 'http://localhost:6172').status, 403);
});
