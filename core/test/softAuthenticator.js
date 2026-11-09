// A Node-side simulated authenticator for tests: P-256 keys from createECDH + createPrivateKey (never EC key-pair
// generation, which aborts on some CI Node builds). It can be told to misbehave so the RP's checks can be proven.
import { createECDH, createHash, createPrivateKey, randomBytes, sign } from 'node:crypto';

const b64u = (b) => Buffer.from(b).toString('base64url');
const sha256 = (b) => createHash('sha256').update(b).digest();

function head(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b;
}
export function cbor(v) {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') { const b = Buffer.from(v, 'utf8'); return Buffer.concat([head(3, b.length), b]); }
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('cbor: unsupported');
}

export function newP256() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const pub = ecdh.getPublicKey(); // 0x04 | x | y
  const d = Buffer.alloc(32); const raw = ecdh.getPrivateKey(); raw.copy(d, 32 - raw.length);
  const x = pub.subarray(1, 33); const y = pub.subarray(33, 65);
  return { x, y, key: createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(x), y: b64u(y), d: b64u(d) }, format: 'jwk' }) };
}

export const coseKey = ({ x, y }, alg = -7) => cbor(new Map([[1, 2], [3, alg], [-1, 1], [-2, x], [-3, y]]));

export function createSoftAuthenticator() {
  const creds = new Map();
  // o: overrides to misbehave: { origin, rpId, type, challenge, flags, alg, crossOrigin, coseKeyBytes, fmt, credId, sentId }
  function create(pk, origin, o = {}) {
    const k = newP256();
    const id = o.credId || randomBytes(16);
    const flags = o.flags ?? 0x45; // UP | UV | AT
    const keyBytes = o.coseKeyBytes || coseKey(k, o.alg ?? -7);
    const idLen = Buffer.alloc(2); idLen.writeUInt16BE(id.length);
    const authData = Buffer.concat([sha256(o.rpId ?? pk.rp.id), Buffer.from([flags]), Buffer.alloc(4), Buffer.alloc(16), idLen, id, keyBytes]);
    const cd = Buffer.from(JSON.stringify({ type: o.type ?? 'webauthn.create', challenge: o.challenge ?? pk.challenge, origin: o.origin ?? origin, crossOrigin: o.crossOrigin ?? false }));
    const att = cbor(new Map([['fmt', o.fmt ?? 'none'], ['attStmt', new Map()], ['authData', authData]]));
    creds.set(b64u(id), { id: b64u(id), key: k.key, userId: pk.user.id, rpId: pk.rp.id, count: 0 });
    return { id: o.sentId ?? b64u(id), rawId: o.sentId ?? b64u(id), type: 'public-key', response: { clientDataJSON: b64u(cd), attestationObject: b64u(att) } };
  }
  // o: { origin, rpId, type, challenge, flags, count, signWith, userHandle, id, crossOrigin }
  function get(pk, origin, o = {}) {
    const c = o.id ? creds.get(o.id) : [...creds.values()].at(-1);
    const count = o.count ?? (c.count += 1);
    const cnt = Buffer.alloc(4); cnt.writeUInt32BE(count);
    const authData = Buffer.concat([sha256(o.rpId ?? pk.rpId), Buffer.from([o.flags ?? 0x05]), cnt]);
    const cd = Buffer.from(JSON.stringify({ type: o.type ?? 'webauthn.get', challenge: o.challenge ?? pk.challenge, origin: o.origin ?? origin, crossOrigin: o.crossOrigin ?? false }));
    const sig = sign('sha256', Buffer.concat([authData, sha256(cd)]), o.signWith || c.key);
    return { id: o.id ?? c.id, rawId: o.id ?? c.id, type: 'public-key', response: { clientDataJSON: b64u(cd), authenticatorData: b64u(authData), signature: b64u(sig), userHandle: o.userHandle === undefined ? c.userId : o.userHandle } };
  }
  return { create, get, creds };
}
