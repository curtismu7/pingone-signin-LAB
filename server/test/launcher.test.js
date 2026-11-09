// The family launcher (lab-proxy) reaches this lab with Host "<name>:6171" and, on API calls, X-Forwarded-Host/-Proto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHostCheck, makeSameOriginWrites, parseAllowedHosts } from '../src/safety.js';

const NAME = 'pingone-signin-lab.local.ping-devops.com';
const allowed = parseAllowedHosts(` ${NAME.toUpperCase()} , `);
const hostCheck = makeHostCheck(allowed, 6171);
const writes = makeSameOriginWrites(allowed, 6171);
const proxied = { host: `${NAME}:6171`, 'x-forwarded-host': 'local.ping-devops.com:8443', 'x-forwarded-proto': 'https', origin: 'https://local.ping-devops.com:8443' };
const run = (mw, req) => { const out = {}; const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } }; mw(req, res, () => { out.next = true; }); return out; };

test('LAB_ALLOWED_HOSTS: comma list, trimmed, lower case; unset is empty', () => {
  assert.deepEqual([...allowed], [NAME]);
  assert.equal(parseAllowedHosts(undefined).size, 0);
});

test('the launcher Host is accepted; loopback still is', () => {
  assert.ok(run(hostCheck, { headers: { host: `${NAME}:6171` } }).next);
  assert.ok(run(hostCheck, { headers: { host: '127.0.0.1:6171' } }).next);
});

test('a Host outside the set, the allowed name on another port, or the bare launcher domain is refused', () => {
  for (const host of ['evil.example:6171', `${NAME}:6172`, 'local.ping-devops.com:8443', `x.${NAME}:6171`]) assert.equal(run(hostCheck, { headers: { host } }).status, 403, host);
  assert.equal(run(makeHostCheck(new Set(), 6171), { headers: { host: `${NAME}:6171` } }).status, 403, 'unset = loopback only');
});

test('a proxied same-origin write is accepted', () => {
  assert.ok(run(writes, { method: 'POST', headers: { ...proxied, 'sec-fetch-site': 'same-origin' } }).next);
});

test('a foreign Origin through the launcher is refused', () => {
  assert.equal(run(writes, { method: 'POST', headers: { ...proxied, origin: 'https://evil.example' } }).status, 403);
  assert.equal(run(writes, { method: 'POST', headers: { ...proxied, 'x-forwarded-proto': 'ftp', origin: 'ftp://local.ping-devops.com:8443' } }).status, 403);
  assert.equal(run(writes, { method: 'POST', headers: { ...proxied, 'x-forwarded-host': '', origin: 'https://' } }).status, 403);
});

test('forwarded headers on a loopback Host are ignored', () => {
  assert.equal(run(writes, { method: 'POST', headers: { ...proxied, host: '127.0.0.1:6171' } }).status, 403);
  assert.equal(run(writes, { method: 'POST', headers: { ...proxied, host: 'evil.example:6171' } }).status, 403);
});
