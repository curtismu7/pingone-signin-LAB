// Mock token signing. HS256 with a throwaway per-process key (random bytes). Nothing here is a credential and the tokens
// verify only against the in-process mock. The key never leaves memory.
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const b64u = (b) => Buffer.from(b).toString('base64url');
const fromB64u = (s) => Buffer.from(s, 'base64url');

export const newKey = () => randomBytes(32);

export function safeEqual(a, b) {
  const x = createHash('sha256').update(String(a)).digest();
  const y = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(x, y);
}

export function signJwt(payload, key, typ = 'JWT') {
  const input = `${b64u(JSON.stringify({ alg: 'HS256', typ }))}.${b64u(JSON.stringify(payload))}`;
  return `${input}.${b64u(createHmac('sha256', key).update(input).digest())}`;
}

// { ok:true, header, payload } or { ok:false, reason }. Refuses any alg but HS256 (so alg:none fails) and an expired token.
export function verifyJwt(token, key, { now = Date.now } = {}) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  let header; let payload;
  try { header = JSON.parse(fromB64u(parts[0])); payload = JSON.parse(fromB64u(parts[1])); } catch { return { ok: false, reason: 'malformed' }; }
  if (!header || header.alg !== 'HS256') return { ok: false, reason: 'bad_alg' };
  const want = b64u(createHmac('sha256', key).update(`${parts[0]}.${parts[1]}`).digest());
  if (!safeEqual(want, parts[2])) return { ok: false, reason: 'bad_signature' };
  if (typeof payload.exp === 'number' && payload.exp <= Math.floor(now() / 1000)) return { ok: false, reason: 'expired', header, payload };
  return { ok: true, header, payload };
}

// Decode without verifying, for display only.
export function decodeJwt(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  try { return { header: JSON.parse(fromB64u(parts[0])), payload: JSON.parse(fromB64u(parts[1])) }; } catch { return null; }
}

export const pkceChallenge = (verifier) => createHash('sha256').update(verifier).digest('base64url');
export const newVerifier = () => randomBytes(32).toString('base64url');
