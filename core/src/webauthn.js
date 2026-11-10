// The lab's own mock WebAuthn relying party (RP): passkey registration (create) and authentication (get), verified the way a
// server must, one named step at a time so the UI can show every check. Pure: node:crypto only, no network, no key-pair
// generation (the RP only verifies; keys are made by the authenticator, the browser's or the page's simulated one).
// MOCK: this is a teaching RP, not PingOne. It accepts ES256 (COSE alg -7, P-256) only and the "none" attestation policy.
import { createHash, createPublicKey, randomBytes, verify as verifySig } from 'node:crypto';

const MAX_B64U = 16_384; // any one base64url field
const MAX_ITEMS = 64; // entries in one CBOR map or array
const MAX_DEPTH = 6;
const MAX_CHALLENGES = 100;
const MAX_CREDENTIALS = 50;
export const FLAG = { UP: 0x01, UV: 0x04, BE: 0x08, BS: 0x10, AT: 0x40, ED: 0x80 };

const b64u = (b) => Buffer.from(b).toString('base64url');
const sha256 = (b) => createHash('sha256').update(b).digest();

export function fromB64u(s, what = 'field') {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) throw new Error(`${what} is not base64url`);
  if (s.length > MAX_B64U) throw new Error(`${what} is too long`);
  return Buffer.from(s, 'base64url');
}

// A small, strict CBOR decoder (RFC 8949): the subset WebAuthn uses. No indefinite lengths, no tags, no floats.
// Returns { value, end }. Maps are returned as Map so integer and text keys stay distinct.
export function cborDecode(buf, start = 0, depth = 0) {
  if (depth > MAX_DEPTH) throw new Error('CBOR nested too deep');
  let p = start;
  const need = (n) => { if (p + n > buf.length) throw new Error('CBOR truncated'); };
  need(1);
  const ib = buf[p++]; const major = ib >> 5; const info = ib & 0x1f;
  let len;
  if (info < 24) len = info;
  else if (info === 24) { need(1); len = buf[p]; p += 1; }
  else if (info === 25) { need(2); len = buf.readUInt16BE(p); p += 2; }
  else if (info === 26) { need(4); len = buf.readUInt32BE(p); p += 4; }
  else if (info === 27) { need(8); const big = buf.readBigUInt64BE(p); p += 8; if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('CBOR integer too large'); len = Number(big); }
  else throw new Error('CBOR indefinite or reserved length');
  switch (major) {
    case 0: return { value: len, end: p };
    case 1: return { value: -1 - len, end: p };
    case 2: need(len); return { value: buf.subarray(p, p + len), end: p + len };
    case 3: need(len); return { value: buf.subarray(p, p + len).toString('utf8'), end: p + len };
    case 4: {
      if (len > MAX_ITEMS) throw new Error('CBOR array too long');
      const out = [];
      for (let i = 0; i < len; i += 1) { const r = cborDecode(buf, p, depth + 1); out.push(r.value); p = r.end; }
      return { value: out, end: p };
    }
    case 5: {
      if (len > MAX_ITEMS) throw new Error('CBOR map too long');
      const out = new Map();
      for (let i = 0; i < len; i += 1) {
        const k = cborDecode(buf, p, depth + 1); p = k.end;
        if (typeof k.value !== 'string' && typeof k.value !== 'number') throw new Error('CBOR map key must be text or integer');
        if (out.has(k.value)) throw new Error('CBOR duplicate map key');
        const v = cborDecode(buf, p, depth + 1); p = v.end;
        out.set(k.value, v.value);
      }
      return { value: out, end: p };
    }
    case 7:
      if (info === 20) return { value: false, end: p };
      if (info === 21) return { value: true, end: p };
      if (info === 22) return { value: null, end: p };
      throw new Error('CBOR simple value not supported');
    default: throw new Error('CBOR tags are not supported');
  }
}
const cborWhole = (buf, what) => { const r = cborDecode(buf); if (r.end !== buf.length) throw new Error(`${what} has trailing bytes`); return r.value; };

// authenticatorData: rpIdHash(32) | flags(1) | signCount(4, big-endian) | [attested credential data] | [extensions]
export function parseAuthData(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 37) throw new Error('authenticatorData is shorter than 37 bytes');
  const flagsByte = buf[32];
  const flags = Object.fromEntries(Object.entries(FLAG).map(([k, bit]) => [k, (flagsByte & bit) !== 0]));
  const out = { rpIdHash: buf.subarray(0, 32), flagsByte, flags, signCount: buf.readUInt32BE(33), attested: null };
  let p = 37;
  if (flags.AT) {
    if (buf.length < p + 18) throw new Error('attested credential data is truncated');
    const aaguid = buf.subarray(p, p + 16); p += 16;
    const idLen = buf.readUInt16BE(p); p += 2;
    if (idLen < 1 || idLen > 1023 || buf.length < p + idLen) throw new Error('credential id length is invalid');
    const credentialId = buf.subarray(p, p + idLen); p += idLen;
    const cose = cborDecode(buf, p); p = cose.end;
    out.attested = { aaguid, credentialId, coseKey: cose.value };
  }
  if (flags.ED) { const ext = cborDecode(buf, p); p = ext.end; out.extensions = ext.value; }
  if (p !== buf.length) throw new Error('authenticatorData has trailing bytes');
  return out;
}

// COSE_Key (RFC 9053) -> a Node public key. ES256 only: kty 2 (EC2), alg -7, crv 1 (P-256), 32-byte x and y on the curve.
export function coseToPublicKey(cose) {
  if (!(cose instanceof Map)) throw new Error('COSE key is not a map');
  if (cose.get(1) !== 2) throw new Error('COSE kty is not EC2');
  if (cose.get(3) !== -7) throw new Error(`COSE alg ${cose.get(3)} is not ES256 (-7)`);
  if (cose.get(-1) !== 1) throw new Error('COSE curve is not P-256');
  const x = cose.get(-2); const y = cose.get(-3);
  if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) throw new Error('COSE x / y are not 32 bytes');
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u(x), y: b64u(y) };
  return { jwk, key: createPublicKey({ key: jwk, format: 'jwk' }) }; // throws when the point is not on the curve
}

export function decodeClientData(b64) {
  const raw = fromB64u(b64, 'clientDataJSON');
  let json;
  try { json = JSON.parse(raw.toString('utf8')); } catch { throw new Error('clientDataJSON is not JSON'); }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('clientDataJSON is not an object');
  return { raw, json };
}

const hex = (b) => Buffer.from(b).toString('hex');
const showAuthData = (a) => ({
  rpIdHash: hex(a.rpIdHash), flags: a.flags, flagsByte: a.flagsByte, signCount: a.signCount,
  ...(a.attested ? { aaguid: hex(a.attested.aaguid), credentialId: b64u(a.attested.credentialId) } : {}),
});

// One mock RP per workspace. users: the mock cast (username -> { name }).
export function createMockRP({ now = Date.now, ttlMs = 120_000, users = {}, rpName = 'PingOne Sign-in LAB mock RP' } = {}) {
  let st;
  function reset() { st = { challenges: new Map(), credentials: new Map(), userIds: new Map() }; }
  reset();

  function issue(kind, origin, extra) {
    let rpId;
    try { const u = new URL(origin); if (!/^https?:$/.test(u.protocol)) throw new Error(); rpId = u.hostname; } catch { throw new Error('origin is not an http(s) origin'); }
    const challenge = b64u(randomBytes(32));
    if (st.challenges.size >= MAX_CHALLENGES) st.challenges.delete(st.challenges.keys().next().value);
    st.challenges.set(challenge, { kind, origin, rpId, exp: now() + ttlMs, ...extra });
    return { challenge, rpId };
  }

  // A challenge is single use: the first verify that names it consumes it, whatever the outcome.
  function take(challenge, kind) {
    const c = typeof challenge === 'string' ? st.challenges.get(challenge) : undefined;
    if (!c) return { ok: false, detail: 'this RP never issued that challenge, or it was already used' };
    st.challenges.delete(challenge);
    if (c.kind !== kind) return { ok: false, detail: `the challenge was issued for ${c.kind}, not ${kind}` };
    if (c.exp <= now()) return { ok: false, detail: 'the challenge has expired' };
    return { ok: true, c };
  }

  function registrationOptions({ username, origin }) {
    if (typeof username !== 'string' || !Object.hasOwn(users, username)) throw new Error('username must be one of the mock cast');
    if (!st.userIds.has(username)) st.userIds.set(username, b64u(randomBytes(16)));
    const userId = st.userIds.get(username);
    const { challenge, rpId } = issue('create', origin, { username, userId });
    return {
      expectedOrigin: origin,
      publicKey: {
        challenge, rp: { id: rpId, name: rpName },
        user: { id: userId, name: username, displayName: users[username].name || username },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
        attestation: 'none', timeout: ttlMs,
        excludeCredentials: [...st.credentials.values()].filter((c) => c.username === username).map((c) => ({ type: 'public-key', id: c.id })),
      },
    };
  }

  function authenticationOptions({ username, origin }) {
    if (username !== undefined && (typeof username !== 'string' || !Object.hasOwn(users, username))) throw new Error('username must be one of the mock cast');
    const { challenge, rpId } = issue('get', origin, { username: username ?? null });
    const allow = username ? [...st.credentials.values()].filter((c) => c.username === username).map((c) => ({ type: 'public-key', id: c.id })) : [];
    return { expectedOrigin: origin, publicKey: { challenge, rpId, allowCredentials: allow, userVerification: 'preferred', timeout: ttlMs } };
  }

  // Shared checks on clientDataJSON. Returns the steps and the consumed challenge record (or null).
  function clientDataSteps(cd, type, kind) {
    const steps = [];
    steps.push({ id: 'type', label: `clientDataJSON.type is ${type}`, ok: cd.json.type === type, detail: `got ${JSON.stringify(cd.json.type)}` });
    const t = take(cd.json.challenge, kind);
    steps.push({ id: 'challenge', label: 'challenge matches one this RP issued (single use, not expired)', ok: t.ok, detail: t.ok ? `consumed ${cd.json.challenge}` : t.detail });
    const c = t.ok ? t.c : null;
    steps.push({ id: 'origin', label: 'origin is the RP origin', ok: !!c && cd.json.origin === c.origin, detail: c ? `expected ${c.origin}, got ${JSON.stringify(cd.json.origin)}` : 'no issued challenge to compare with' });
    steps.push({ id: 'crossOrigin', label: 'not a cross-origin (iframe) ceremony', ok: cd.json.crossOrigin !== true, detail: `crossOrigin = ${JSON.stringify(cd.json.crossOrigin ?? false)}` });
    return { steps, c };
  }
  const rpIdStep = (auth, c) => {
    const want = c ? sha256(c.rpId) : null;
    return { id: 'rpIdHash', label: 'authenticatorData.rpIdHash = SHA-256(RP ID)', ok: !!want && want.equals(auth.rpIdHash), detail: c ? `RP ID ${c.rpId}: expected ${hex(want)}, got ${hex(auth.rpIdHash)}` : 'no issued challenge, so no RP ID to hash' };
  };
  const upStep = (auth) => ({ id: 'UP', label: 'User Present flag (UP) is set', ok: auth.flags.UP, detail: `flags byte 0x${auth.flagsByte.toString(16).padStart(2, '0')}` });
  const uvStep = (auth) => ({ id: 'UV', label: 'User Verified flag (UV): preferred, reported only', ok: true, info: true, detail: auth.flags.UV ? 'UV set: the authenticator verified the user (PIN or biometric)' : 'UV not set: presence only' });
  const fail = (steps, label, e) => ({ ok: false, steps: [...steps, { id: 'decode', label, ok: false, detail: String(e.message || e) }] });

  function verifyRegistration(cred) {
    const steps = [];
    let cd;
    try {
      if (!cred || typeof cred !== 'object' || !cred.response || typeof cred.response !== 'object') throw new Error('expected a PublicKeyCredential as JSON');
      if (cred.type !== 'public-key') throw new Error('type must be public-key');
      cd = decodeClientData(cred.response.clientDataJSON);
    } catch (e) { return fail(steps, 'the credential and clientDataJSON decode', e); }
    const { steps: s1, c } = clientDataSteps(cd, 'webauthn.create', 'create');
    steps.push(...s1);
    let att; let auth;
    try {
      att = cborWhole(fromB64u(cred.response.attestationObject, 'attestationObject'), 'attestationObject');
      if (!(att instanceof Map) || typeof att.get('fmt') !== 'string' || !Buffer.isBuffer(att.get('authData'))) throw new Error('attestationObject needs fmt and authData');
      auth = parseAuthData(att.get('authData'));
    } catch (e) { return { ...fail(steps, 'attestationObject and authenticatorData decode', e), clientData: cd.json }; }
    steps.push(rpIdStep(auth, c), upStep(auth), uvStep(auth));
    const credId = auth.attested ? b64u(auth.attested.credentialId) : null;
    steps.push({ id: 'BE/BS', label: 'flags are consistent: Backed up (BS) only with Backup Eligible (BE)', ok: !(auth.flags.BS && !auth.flags.BE), detail: `BE ${auth.flags.BE ? 1 : 0}, BS ${auth.flags.BS ? 1 : 0}` });
    steps.push({ id: 'AT', label: 'attested credential data present, and its id is the credential id sent', ok: !!credId && credId === cred.id && (cred.rawId === undefined || cred.rawId === cred.id), detail: `authData id ${credId}, sent id ${JSON.stringify(cred.id)}` });
    let pub = null; let algDetail = 'no attested credential data';
    if (auth.attested) { try { pub = coseToPublicKey(auth.attested.coseKey); algDetail = 'EC2 key on P-256'; } catch (e) { algDetail = e.message; } }
    steps.push({ id: 'alg', label: 'public key is ES256 (COSE -7, P-256)', ok: !!pub, detail: algDetail });
    steps.push({ id: 'attestation', label: `attestation format "${att.get('fmt')}": statement not checked (this RP asked for attestation "none")`, ok: true, info: true, detail: 'mock policy: any format is accepted and its statement is ignored' });
    const dupe = credId && st.credentials.has(credId);
    steps.push({ id: 'new', label: 'credential id is not already registered', ok: !!credId && !dupe, detail: dupe ? 'already registered' : 'new' });
    const ok = steps.every((x) => x.ok);
    if (ok) {
      if (st.credentials.size >= MAX_CREDENTIALS) st.credentials.delete(st.credentials.keys().next().value);
      st.credentials.set(credId, { id: credId, key: pub.key, jwk: pub.jwk, signCount: auth.signCount, username: c.username, userId: c.userId, rpId: c.rpId, be: auth.flags.BE, bs: auth.flags.BS, created: now() });
    }
    return { ok, steps, clientData: cd.json, authData: { ...showAuthData(auth), publicKeyJwk: pub ? pub.jwk : null }, fmt: att.get('fmt'), user: ok ? c.username : null };
  }

  function verifyAuthentication(cred) {
    const steps = [];
    let cd; let authRaw; let auth;
    try {
      if (!cred || typeof cred !== 'object' || !cred.response || typeof cred.response !== 'object') throw new Error('expected a PublicKeyCredential as JSON');
      if (cred.type !== 'public-key') throw new Error('type must be public-key');
      cd = decodeClientData(cred.response.clientDataJSON);
      authRaw = fromB64u(cred.response.authenticatorData, 'authenticatorData');
      auth = parseAuthData(authRaw);
    } catch (e) { return fail(steps, 'the credential, clientDataJSON and authenticatorData decode', e); }
    const stored = typeof cred.id === 'string' ? st.credentials.get(cred.id) : undefined;
    const shownId = typeof cred.id === 'string' ? JSON.stringify(cred.id.slice(0, 80)) : '(not a string)';
    steps.push({ id: 'credential', label: 'credential id is registered with this RP (and rawId is the same id)', ok: !!stored && (cred.rawId === undefined || cred.rawId === cred.id), detail: stored ? `belongs to ${stored.username}` : `unknown id ${shownId}` });
    const { steps: s1, c } = clientDataSteps(cd, 'webauthn.get', 'get');
    steps.push(...s1);
    if (c && stored) steps.push({ id: 'rpId', label: 'the passkey was registered for this RP ID', ok: stored.rpId === c.rpId, detail: `registered for ${stored.rpId}, ceremony RP ID ${c.rpId}` });
    steps.push(rpIdStep(auth, c), upStep(auth), uvStep(auth));
    if (c && c.username && stored) steps.push({ id: 'allowed', label: 'credential belongs to the user the challenge was issued for', ok: stored.username === c.username, detail: `challenge for ${c.username}, credential of ${stored.username}` });
    let sigOk = false; let sigDetail = 'no stored public key to check against';
    if (stored) {
      try {
        const sig = fromB64u(cred.response.signature, 'signature');
        sigOk = verifySig('sha256', Buffer.concat([authRaw, sha256(cd.raw)]), stored.key, sig);
        sigDetail = sigOk ? 'ECDSA P-256 / SHA-256 over authenticatorData || SHA-256(clientDataJSON) verifies with the stored public key' : 'the signature does not verify with the stored public key';
      } catch (e) { sigDetail = `signature could not be checked: ${e.message}`; }
    }
    steps.push({ id: 'signature', label: 'signature verifies against the stored public key', ok: sigOk, detail: sigDetail });
    // WebAuthn L3 6.1.1: if either counter is non-zero, the new one must be greater. Otherwise it may be a cloned authenticator or a replay.
    const before = stored ? stored.signCount : null;
    const countOk = !!stored && ((auth.signCount === 0 && before === 0) || auth.signCount > before);
    steps.push({ id: 'signCount', label: 'signCount went up (or both are 0)', ok: countOk, detail: stored ? `stored ${before}, received ${auth.signCount}${countOk ? '' : ': possible cloned authenticator or replay'}` : 'no stored credential' });
    // WebAuthn L3 7.2: when the user was not named before the ceremony (a discoverable passkey), the userHandle is required.
    if (c && !c.username && cred.response.userHandle == null) steps.push({ id: 'userHandle', label: 'userHandle is present (required when the user was not named first)', ok: false, detail: 'missing' });
    else if (cred.response.userHandle != null && stored) steps.push({ id: 'userHandle', label: 'userHandle is the user.id registered with the credential', ok: cred.response.userHandle === stored.userId, detail: `expected ${stored.userId}, got ${typeof cred.response.userHandle === 'string' ? JSON.stringify(cred.response.userHandle.slice(0, 80)) : '(not a string)'}` });
    const ok = steps.every((x) => x.ok);
    if (ok) { stored.signCount = auth.signCount; stored.bs = auth.flags.BS; }
    return { ok, steps, clientData: cd.json, authData: showAuthData(auth), signCountBefore: before, user: ok ? stored.username : null };
  }

  const listCredentials = () => [...st.credentials.values()].map(({ id, jwk, signCount, username, userId, rpId, be, bs, created }) => ({ id, publicKeyJwk: jwk, signCount, username, userId, rpId, backupEligible: be, backedUp: bs, created }));

  return { registrationOptions, authenticationOptions, verifyRegistration, verifyAuthentication, listCredentials, reset, _state: () => st };
}
