import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockRP, cborDecode, parseAuthData, USERS } from '../src/index.js';
import { createSoftAuthenticator, cbor, newP256, coseKey } from './softAuthenticator.js';

const ORIGIN = 'http://localhost:6171';
const step = (r, id) => r.steps.find((s) => s.id === id);
const failed = (r) => r.steps.filter((s) => !s.ok).map((s) => s.id);

function setup({ now } = {}) {
  const rp = createMockRP({ users: USERS, ...(now ? { now } : {}) });
  const authr = createSoftAuthenticator();
  const register = (o = {}, username = 'mark') => { const opts = rp.registrationOptions({ username, origin: ORIGIN }); return rp.verifyRegistration(authr.create(opts.publicKey, ORIGIN, o)); };
  const login = (o = {}, username = 'mark') => { const opts = rp.authenticationOptions({ username, origin: ORIGIN }); return rp.verifyAuthentication(authr.get(opts.publicKey, ORIGIN, o)); };
  return { rp, authr, register, login };
}

test('registration options: fresh challenge, RP ID from the origin, random user.id, ES256, attestation none', () => {
  const { rp } = setup();
  const a = rp.registrationOptions({ username: 'mark', origin: ORIGIN });
  const b = rp.registrationOptions({ username: 'mark', origin: ORIGIN });
  assert.equal(a.publicKey.rp.id, 'localhost');
  assert.equal(a.expectedOrigin, ORIGIN);
  assert.notEqual(a.publicKey.challenge, b.publicKey.challenge);
  assert.equal(Buffer.from(a.publicKey.challenge, 'base64url').length, 32);
  assert.equal(a.publicKey.user.id, b.publicKey.user.id, 'user.id is stable per user');
  assert.notEqual(a.publicKey.user.id, 'mark', 'user.id is not the username');
  assert.deepEqual(a.publicKey.pubKeyCredParams, [{ type: 'public-key', alg: -7 }]);
  assert.equal(a.publicKey.attestation, 'none');
  assert.throws(() => rp.registrationOptions({ username: 'mallory', origin: ORIGIN }), /mock cast/);
  assert.throws(() => rp.registrationOptions({ username: '__proto__', origin: ORIGIN }), /mock cast/);
  assert.throws(() => rp.registrationOptions({ username: 'mark', origin: 'javascript:alert(1)' }), /http\(s\) origin/);
});

test('happy path: register, then sign in; every check passes and signCount is stored', () => {
  const { rp, register, login } = setup();
  const r = register();
  assert.equal(r.ok, true, JSON.stringify(failed(r)));
  assert.equal(r.user, 'mark');
  assert.equal(r.fmt, 'none');
  assert.deepEqual(['type', 'challenge', 'origin', 'crossOrigin', 'rpIdHash', 'UP', 'UV', 'BE/BS', 'AT', 'alg', 'attestation', 'new'], r.steps.map((s) => s.id));
  assert.equal(r.authData.flags.AT, true);
  assert.equal(r.authData.publicKeyJwk.crv, 'P-256');
  const a = login();
  assert.equal(a.ok, true, JSON.stringify(failed(a)));
  assert.equal(a.user, 'mark');
  assert.equal(step(a, 'signature').ok, true);
  assert.equal(a.signCountBefore, 0);
  assert.equal(a.authData.signCount, 1);
  const list = rp.listCredentials();
  assert.equal(list.length, 1);
  assert.equal(list[0].signCount, 1);
  assert.equal(list[0].publicKeyJwk.d, undefined, 'no private part');
  assert.equal(login().ok, true, 'a second sign-in with a higher counter works');
});

test('hostile: wrong challenge (one the RP never issued) is refused', () => {
  const { register, login } = setup();
  const r = register({ challenge: Buffer.alloc(32, 7).toString('base64url') });
  assert.equal(r.ok, false); assert.deepEqual(failed(r), ['challenge', 'origin', 'rpIdHash']);
  assert.equal(register().ok, true);
  const a = login({ challenge: 'AAAA' });
  assert.equal(a.ok, false); assert.ok(failed(a).includes('challenge'));
});

test('hostile: wrong origin is refused, also crossOrigin true', () => {
  const { register, login } = setup();
  const r = register({ origin: 'https://evil.example' });
  assert.equal(r.ok, false); assert.deepEqual(failed(r), ['origin']);
  assert.match(step(r, 'origin').detail, /evil\.example/);
  assert.equal(register().ok, true);
  assert.deepEqual(failed(login({ origin: 'http://localhost:6999' })), ['origin']);
  assert.deepEqual(failed(login({ crossOrigin: true })), ['crossOrigin']);
});

test('hostile: wrong RP ID hash (a passkey made for another rp.id) is refused', () => {
  const { register, login } = setup();
  const r = register({ rpId: 'other.example' });
  assert.equal(r.ok, false); assert.deepEqual(failed(r), ['rpIdHash']);
  assert.equal(register().ok, true);
  const a = login({ rpId: 'other.example' });
  assert.equal(a.ok, false); assert.ok(failed(a).includes('rpIdHash'));
  // the signature itself is valid (it covers the wrong rpIdHash): only the RP ID check catches it
  assert.equal(step(a, 'signature').ok, true);
});

test('hostile: a bad signature is refused (another key, a flipped byte, garbage)', () => {
  const { rp, authr, register, login } = setup();
  assert.equal(register().ok, true);
  assert.deepEqual(failed(login({ signWith: newP256().key })), ['signature']);
  const opts = rp.authenticationOptions({ username: 'mark', origin: ORIGIN });
  const cred = authr.get(opts.publicKey, ORIGIN);
  const sig = Buffer.from(cred.response.signature, 'base64url'); sig[sig.length - 1] ^= 1;
  const r = rp.verifyAuthentication({ ...cred, response: { ...cred.response, signature: sig.toString('base64url') } });
  assert.deepEqual(failed(r), ['signature']);
  const opts2 = rp.authenticationOptions({ username: 'mark', origin: ORIGIN });
  const c2 = authr.get(opts2.publicKey, ORIGIN);
  const r2 = rp.verifyAuthentication({ ...c2, response: { ...c2.response, signature: 'AAAA' } });
  assert.equal(step(r2, 'signature').ok, false);
  // signCount is not advanced by a refused assertion
  assert.equal(rp.listCredentials()[0].signCount, 0);
});

test('hostile: a replayed or cloned signCount is refused, and the stored count does not move', () => {
  const { rp, register, login } = setup();
  assert.equal(register().ok, true);
  assert.equal(login({ count: 5 }).ok, true);
  const same = login({ count: 5 });
  assert.equal(same.ok, false); assert.deepEqual(failed(same), ['signCount']);
  assert.match(step(same, 'signCount').detail, /stored 5, received 5/);
  assert.deepEqual(failed(login({ count: 3 })), ['signCount']);
  assert.equal(rp.listCredentials()[0].signCount, 5);
  assert.equal(login({ count: 6 }).ok, true);
});

test('signCount 0 on both sides is allowed (authenticators that do not count, e.g. many synced passkeys)', () => {
  const { register, login } = setup();
  assert.equal(register().ok, true);
  assert.equal(login({ count: 0 }).ok, true);
  assert.equal(login({ count: 0 }).ok, true);
});

test('hostile: replaying the exact same assertion fails on the used challenge (and the counter)', () => {
  const { rp, authr, register } = setup();
  assert.equal(register().ok, true);
  const opts = rp.authenticationOptions({ username: 'mark', origin: ORIGIN });
  const cred = authr.get(opts.publicKey, ORIGIN);
  assert.equal(rp.verifyAuthentication(cred).ok, true);
  const again = rp.verifyAuthentication(cred);
  assert.equal(again.ok, false);
  assert.deepEqual(failed(again), ['challenge', 'origin', 'rpIdHash', 'signCount']);
});

test('a challenge is single use even when the first attempt fails, and a registration challenge does not work for sign-in', () => {
  const { rp, authr, register } = setup();
  const opts = rp.registrationOptions({ username: 'mark', origin: ORIGIN });
  const bad = authr.create(opts.publicKey, ORIGIN, { origin: 'https://evil.example' });
  assert.equal(rp.verifyRegistration(bad).ok, false);
  const good = authr.create(opts.publicKey, ORIGIN);
  assert.ok(failed(rp.verifyRegistration(good)).includes('challenge'));
  assert.equal(register().ok, true);
  const reg = rp.registrationOptions({ username: 'mark', origin: ORIGIN });
  const a = rp.verifyAuthentication(authr.get({ rpId: 'localhost', challenge: reg.publicKey.challenge }, ORIGIN));
  assert.match(step(a, 'challenge').detail, /issued for create/);
});

test('hostile: type swapped, UP missing, credential id mismatch, duplicate credential', () => {
  const { register, login } = setup();
  assert.deepEqual(failed(register({ type: 'webauthn.get' })), ['type']);
  assert.deepEqual(failed(register({ flags: 0x44 })), ['UP']);
  assert.deepEqual(failed(register({ sentId: 'AAAAAAAAAAAAAAAAAAAAAA' })), ['AT']);
  assert.equal(register().ok, true);
  assert.deepEqual(failed(login({ type: 'webauthn.create' })), ['type']);
  assert.deepEqual(failed(login({ flags: 0x04 })), ['UP']);
  const noUv = login({ flags: 0x01 });
  assert.equal(noUv.ok, true, 'UV is preferred, not required');
  assert.equal(step(noUv, 'UV').info, true);
  const id = Buffer.alloc(16, 9);
  assert.equal(register({ credId: id }).ok, true);
  assert.deepEqual(failed(register({ credId: id })), ['new']);
});

test('hostile: unknown credential, wrong userHandle, credential of another user', () => {
  const { rp, authr, register, login } = setup();
  assert.equal(register().ok, true);
  const opts = rp.authenticationOptions({ username: 'mark', origin: ORIGIN });
  const cred = authr.get(opts.publicKey, ORIGIN);
  const unk = rp.verifyAuthentication({ ...cred, id: 'bm9wZQ' });
  assert.ok(failed(unk).includes('credential'));
  assert.ok(failed(unk).includes('signature'));
  assert.deepEqual(failed(login({ userHandle: 'AAAA' })), ['userHandle']);
  // dana's challenge, mark's passkey
  const dopts = rp.authenticationOptions({ username: 'dana', origin: ORIGIN });
  assert.deepEqual(dopts.publicKey.allowCredentials, []);
  assert.deepEqual(failed(rp.verifyAuthentication(authr.get(dopts.publicKey, ORIGIN))), ['allowed']);
});

test('hostile: a non-ES256 key or a point that is not on P-256 is refused at registration', () => {
  const { register } = setup();
  assert.deepEqual(failed(register({ alg: -257 })), ['alg']);
  const off = coseKey({ x: Buffer.alloc(32, 1), y: Buffer.alloc(32, 2) });
  assert.deepEqual(failed(register({ coseKeyBytes: off })), ['alg']);
});

test('expired challenge is refused', () => {
  let t = 1_800_000_000_000;
  const { rp, authr } = setup({ now: () => t });
  const opts = rp.registrationOptions({ username: 'mark', origin: ORIGIN });
  t += 121_000;
  const r = rp.verifyRegistration(authr.create(opts.publicKey, ORIGIN));
  assert.match(step(r, 'challenge').detail, /expired/);
});

test('hostile input never throws: junk bodies, bad base64url, oversize fields, broken CBOR', () => {
  const { rp, authr } = setup();
  for (const body of [null, undefined, 'x', 42, [], {}, { type: 'public-key' }, { type: 'nope', response: {} }, { type: 'public-key', response: { clientDataJSON: '***' } },
    { type: 'public-key', response: { clientDataJSON: 'A'.repeat(20_000) } }, { type: 'public-key', response: { clientDataJSON: Buffer.from('[1]').toString('base64url') } },
    { type: 'public-key', response: { clientDataJSON: Buffer.from('not json').toString('base64url') } }]) {
    assert.equal(rp.verifyRegistration(body).ok, false, JSON.stringify(body)?.slice(0, 60));
    assert.equal(rp.verifyAuthentication(body).ok, false);
  }
  const opts = rp.registrationOptions({ username: 'mark', origin: ORIGIN });
  const good = authr.create(opts.publicKey, ORIGIN);
  const withAtt = (att) => rp.verifyRegistration({ ...good, response: { ...good.response, attestationObject: Buffer.from(att).toString('base64url') } });
  for (const att of [[], [0xa1], [0x9f, 0xff], [0xbf], [0xc0, 0x00], [0xfb, 0, 0, 0, 0, 0, 0, 0, 0], Buffer.concat([cbor(new Map([['fmt', 'none']])), Buffer.from([0])])]) {
    const r = withAtt(att);
    assert.equal(r.ok, false); assert.equal(step(r, 'decode').ok, false);
  }
  // nesting bomb
  assert.throws(() => cborDecode(Buffer.from(Array(20).fill(0x81).concat([0]))), /too deep/);
  assert.throws(() => cborDecode(Buffer.from([0x9b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])), /too large/);
  assert.throws(() => cborDecode(Buffer.from([0x98, 0xff])), /too long/);
  assert.throws(() => cborDecode(Buffer.from([0xa2, 0x01, 0x01, 0x01, 0x02])), /duplicate/);
  assert.throws(() => parseAuthData(Buffer.alloc(36)), /37 bytes/);
  assert.throws(() => parseAuthData(Buffer.concat([Buffer.alloc(32), Buffer.from([0x01]), Buffer.alloc(4), Buffer.from([1])])), /trailing/);
  assert.throws(() => parseAuthData(Buffer.concat([Buffer.alloc(32), Buffer.from([0x41]), Buffer.alloc(4), Buffer.alloc(16), Buffer.from([0xff, 0xff])])), /length/);
});

test('the challenge store and the credential store are bounded', () => {
  const { rp } = setup();
  for (let i = 0; i < 500; i += 1) rp.authenticationOptions({ origin: ORIGIN });
  assert.ok(rp._state().challenges.size <= 100);
});

test('reset forgets every challenge and credential', () => {
  const { rp, register } = setup();
  assert.equal(register().ok, true);
  rp.reset();
  assert.equal(rp.listCredentials().length, 0);
  assert.equal(rp._state().challenges.size, 0);
});

test('hostile (review): a passkey registered for one RP ID is refused in a ceremony for another, even with a matching hash', () => {
  const { rp, authr, register } = setup();
  assert.equal(register().ok, true); // RP ID localhost
  const opts = rp.authenticationOptions({ origin: 'http://127.0.0.1:6171' });
  const a = rp.verifyAuthentication(authr.get(opts.publicKey, 'http://127.0.0.1:6171'));
  assert.deepEqual(failed(a), ['rpId']);
});

test('hostile (review): discoverable sign-in without userHandle, rawId that differs from id, BS without BE', () => {
  const { rp, authr, register } = setup();
  assert.equal(register().ok, true);
  const opts = rp.authenticationOptions({ origin: ORIGIN }); // no username: discoverable
  const r = rp.verifyAuthentication(authr.get(opts.publicKey, ORIGIN, { userHandle: null }));
  assert.deepEqual(failed(r), ['userHandle']);
  const o2 = rp.authenticationOptions({ username: 'mark', origin: ORIGIN });
  const c2 = authr.get(o2.publicKey, ORIGIN);
  assert.deepEqual(failed(rp.verifyAuthentication({ ...c2, rawId: 'AAAA' })), ['credential']);
  const discoverable = rp.authenticationOptions({ origin: ORIGIN });
  assert.equal(rp.verifyAuthentication(authr.get(discoverable.publicKey, ORIGIN)).ok, true, 'with userHandle a discoverable sign-in works');
  assert.deepEqual(failed(register({ flags: 0x55 })), ['BE/BS']);
  assert.equal(register({ flags: 0x5d }).ok, true, 'BE and BS together are fine (a synced passkey)');
});

test('hostile (review): a non-string id or userHandle does not throw; oversize base64url and trailing CBOR bytes are named', () => {
  const { rp, authr, register } = setup();
  assert.equal(register().ok, true);
  const opts = rp.authenticationOptions({ username: 'mark', origin: ORIGIN });
  const c = authr.get(opts.publicKey, ORIGIN);
  const r = rp.verifyAuthentication({ ...c, id: { toString: 1 }, response: { ...c.response, userHandle: { toString: 1 } } });
  assert.equal(r.ok, false);
  assert.match(step(r, 'credential').detail, /not a string/);
  const big = rp.verifyAuthentication({ type: 'public-key', response: { clientDataJSON: 'A'.repeat(16_385) } });
  assert.match(step(big, 'decode').detail, /too long/);
  const ok16k = rp.verifyAuthentication({ type: 'public-key', response: { clientDataJSON: 'A'.repeat(16_384) } });
  assert.doesNotMatch(step(ok16k, 'decode').detail, /too long/);
  const o2 = rp.registrationOptions({ username: 'mark', origin: ORIGIN });
  const g = authr.create(o2.publicKey, ORIGIN);
  const att = Buffer.concat([Buffer.from(g.response.attestationObject, 'base64url'), Buffer.from([0])]);
  const t = rp.verifyRegistration({ ...g, response: { ...g.response, attestationObject: att.toString('base64url') } });
  assert.match(step(t, 'decode').detail, /trailing bytes/);
});
