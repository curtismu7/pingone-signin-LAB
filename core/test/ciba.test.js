import test from 'node:test';
import assert from 'node:assert/strict';
import { lab } from './helpers.js';
import { decodeJwt } from '../src/index.js';

test('approve: pending, then tokens once the mock phone approves; tokens are issued once', async () => {
  const l = lab(); const c = l.ciba();
  const s = await c.start({ loginHint: 'mark', bindingMessage: 'AB12' });
  assert.equal(s.status, 200);
  assert.equal(s.json.interval, 5);
  assert.equal(s.json.expires_in, 120);
  assert.equal((await c.poll()).json.error, 'authorization_pending');
  l.clk.advance(6);
  const pend = await l.fetchLike('https://mock-op.example/phone/pending?login_hint=mark');
  assert.equal((await pend.json()).pending[0].binding_message, 'AB12');
  assert.equal((await c.phone('approve')).status, 200);
  const t = await c.poll();
  assert.equal(t.status, 200);
  assert.equal(decodeJwt(t.json.id_token).payload.sub, 'usr-mark');
  assert.deepEqual(decodeJwt(t.json.id_token).payload.amr, ['ciba']);
  l.clk.advance(6);
  assert.equal((await c.poll()).json.error, 'invalid_grant');
});

test('deny gives access_denied and the phone cannot then approve', async () => {
  const l = lab(); const c = l.ciba();
  await c.start({ loginHint: 'mark' });
  await c.phone('deny');
  assert.equal((await c.poll()).json.error, 'access_denied');
  assert.equal((await c.phone('approve')).status, 409);
});

test('expiry gives expired_token, and the phone cannot answer late', async () => {
  const l = lab(); const c = l.ciba();
  await c.start({ loginHint: 'mark', requestedExpiry: 30 });
  l.clk.advance(31);
  assert.equal((await c.poll()).json.error, 'expired_token');
  assert.equal((await c.phone('approve')).json.error, 'expired_token');
});

test('polling faster than the interval gets slow_down and the interval grows by 5', async () => {
  const l = lab(); const c = l.ciba();
  await c.start({ loginHint: 'mark' });
  assert.equal((await c.poll()).json.error, 'authorization_pending');
  const sd = await c.poll();
  assert.equal(sd.json.error, 'slow_down');
  assert.match(sd.json.error_description, /10s/);
  l.clk.advance(6);
  assert.equal((await c.poll()).json.error, 'slow_down', '6s is under the new 10s interval');
  l.clk.advance(16);
  assert.equal((await c.poll()).json.error, 'authorization_pending');
});

test('binding_message: 9 characters refused, 8 fine, counted in characters, control characters refused', async () => {
  const l = lab(); const c = l.ciba();
  const bad = await c.start({ loginHint: 'mark', bindingMessage: '123456789' });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, 'invalid_binding_message');
  assert.equal((await c.start({ loginHint: 'mark', bindingMessage: '12345678' })).status, 200);
  assert.equal((await c.start({ loginHint: 'mark', bindingMessage: '日本語日本語日本' })).status, 200);
  assert.equal((await c.start({ loginHint: 'mark', bindingMessage: 'bad\nmsg' })).json.error, 'invalid_binding_message');
});

test('bc-authorize validation: unknown user, missing hint, scope, expiry, client', async () => {
  const l = lab(); const c = l.ciba();
  assert.equal((await c.start({ loginHint: 'ghost' })).json.error, 'unknown_user_id');
  assert.equal((await c.start({ loginHint: '' })).json.error, 'invalid_request');
  assert.equal((await c.start({ loginHint: 'mark', scope: 'profile' })).json.error, 'invalid_scope');
  assert.equal((await c.start({ loginHint: 'mark', requestedExpiry: 99999 })).json.error, 'invalid_request');
  c.clientId = 'nope';
  assert.equal((await c.start({ loginHint: 'mark' })).json.error, 'invalid_client');
});

test('phone rejects malformed or unknown auth_req_id; another client cannot redeem', async () => {
  const l = lab(); const c = l.ciba();
  await c.start({ loginHint: 'mark' });
  const real = c.authReqId;
  c.authReqId = '..bad';
  assert.equal((await c.phone('approve')).status, 400);
  c.authReqId = 'abcdefghijk';
  assert.equal((await c.phone('approve')).status, 404);
  c.authReqId = real;
  await c.phone('approve');
  c.clientId = 'lab-other';
  assert.equal((await c.poll()).json.error, 'invalid_grant');
});
