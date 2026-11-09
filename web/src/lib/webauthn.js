// Passkey (WebAuthn) helpers for the Passkey tab: base64url, the JSON <-> ArrayBuffer conversion the browser API needs, and a
// SIMULATED authenticator for browsers (or hosts) where a real passkey cannot run. Everything here talks only to this page.
export const b64u = (bytes) => { let s = ""; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
export const unb64u = (s) => { const t = String(s).replace(/-/g, "+").replace(/_/g, "/"); const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4)); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); };
const utf8 = (s) => new TextEncoder().encode(s);
const sha256 = async (b) => new Uint8Array(await crypto.subtle.digest("SHA-256", b));
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };

// The page's own origin, as a browser puts it in clientDataJSON. (A function so tests can stand in a different origin.)
export const pageOrigin = () => window.location.origin;

const IP_HOST = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])$/i;
// Can this page use the browser's own passkeys (navigator.credentials)? The RP ID must be a domain the page is on: an IP
// address (127.0.0.1) is never a valid RP ID, so on http://127.0.0.1 the browser refuses and the simulated authenticator is used.
export function browserPasskeySupport(win = window) {
  if (!win.PublicKeyCredential || !win.navigator?.credentials?.create) return { ok: false, reason: "This browser has no WebAuthn (navigator.credentials / PublicKeyCredential)." };
  if (!win.isSecureContext) return { ok: false, reason: "WebAuthn needs a secure context: https, or http on localhost." };
  if (IP_HOST.test(win.location.hostname)) return { ok: false, reason: `The page is on ${win.location.hostname}, an IP address. A passkey's RP ID must be a domain name, so the browser refuses it here. Open the lab on http://localhost:${win.location.port || "6171"}/ to use this browser's passkeys.` };
  return { ok: true, reason: null };
}

// Server JSON options -> the shapes navigator.credentials wants (challenge, user.id and credential ids as ArrayBuffers).
export function toCreateOptions(pk) {
  return { ...pk, challenge: unb64u(pk.challenge), user: { ...pk.user, id: unb64u(pk.user.id) }, excludeCredentials: (pk.excludeCredentials || []).map((c) => ({ ...c, id: unb64u(c.id) })) };
}
export function toGetOptions(pk) {
  return { ...pk, challenge: unb64u(pk.challenge), allowCredentials: (pk.allowCredentials || []).map((c) => ({ ...c, id: unb64u(c.id) })) };
}
// A PublicKeyCredential -> plain JSON with base64url fields (what the RP's verify endpoints take).
export function credentialToJSON(cred) {
  const r = cred.response;
  const response = { clientDataJSON: b64u(r.clientDataJSON) };
  if (r.attestationObject) response.attestationObject = b64u(r.attestationObject);
  if (r.authenticatorData) { response.authenticatorData = b64u(r.authenticatorData); response.signature = b64u(r.signature); response.userHandle = r.userHandle ? b64u(r.userHandle) : null; }
  return { id: cred.id, rawId: b64u(cred.rawId), type: cred.type, authenticatorAttachment: cred.authenticatorAttachment ?? null, response };
}
export function decodeClientDataJSON(s) { try { return JSON.parse(new TextDecoder().decode(unb64u(s))); } catch { return null; } }

// ---- simulated authenticator (MOCK) ----
// A minimal CBOR encoder: unsigned and negative integers, byte strings, text and maps. Enough for an attestationObject and a COSE key.
function cborHead(major, n) {
  if (n < 24) return Uint8Array.of((major << 5) | n);
  if (n < 0x100) return Uint8Array.of((major << 5) | 24, n);
  if (n < 0x10000) return Uint8Array.of((major << 5) | 25, n >> 8, n & 0xff);
  return Uint8Array.of((major << 5) | 26, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}
export function cbor(v) {
  if (typeof v === "number") return v >= 0 ? cborHead(0, v) : cborHead(1, -1 - v);
  if (typeof v === "string") { const b = utf8(v); return concat(cborHead(3, b.length), b); }
  if (v instanceof Uint8Array) return concat(cborHead(2, v.length), v);
  if (v instanceof Map) return concat(cborHead(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)]));
  throw new Error("cbor: unsupported value");
}
// WebCrypto ECDSA signs as r||s (64 bytes); WebAuthn carries an ASN.1 DER signature.
export function p1363ToDer(sig) {
  const int = (b) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i += 1; const v = b.slice(i); return v[0] & 0x80 ? concat(Uint8Array.of(0), v) : v; };
  const r = int(sig.slice(0, 32)); const s = int(sig.slice(32));
  const body = concat(Uint8Array.of(2, r.length), r, Uint8Array.of(2, s.length), s);
  return concat(Uint8Array.of(0x30, body.length), body);
}
const FLAGS = { UP: 0x01, UV: 0x04, AT: 0x40 };
const u32 = (n) => Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);

// Holds its keys in this page's memory only (gone on reload). Device-bound: BE and BS are 0. Always reports UP and UV.
export function createSimulatedAuthenticator() {
  const creds = new Map(); // id -> { id, rpId, userId, key, signCount }
  async function create(pk, origin) {
    const key = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const jwk = await crypto.subtle.exportKey("jwk", key.publicKey);
    const id = crypto.getRandomValues(new Uint8Array(16));
    const coseKey = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, unb64u(jwk.x)], [-3, unb64u(jwk.y)]]));
    const authData = concat(await sha256(utf8(pk.rp.id)), Uint8Array.of(FLAGS.UP | FLAGS.UV | FLAGS.AT), u32(0), new Uint8Array(16), Uint8Array.of(0, id.length), id, coseKey);
    const clientDataJSON = utf8(JSON.stringify({ type: "webauthn.create", challenge: pk.challenge, origin, crossOrigin: false }));
    const attestationObject = cbor(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
    creds.set(b64u(id), { id: b64u(id), rpId: pk.rp.id, userId: pk.user.id, key: key.privateKey, signCount: 0 });
    return { id: b64u(id), rawId: b64u(id), type: "public-key", authenticatorAttachment: "platform", response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject) } };
  }
  async function get(pk, origin) {
    const allowed = (pk.allowCredentials || []).map((c) => c.id);
    const c = [...creds.values()].reverse().find((x) => x.rpId === pk.rpId && (allowed.length === 0 || allowed.includes(x.id)));
    if (!c) throw new Error(`The simulated authenticator holds no passkey for RP ID ${pk.rpId}. Register one first.`);
    c.signCount += 1;
    const authenticatorData = concat(await sha256(utf8(pk.rpId)), Uint8Array.of(FLAGS.UP | FLAGS.UV), u32(c.signCount));
    const clientDataJSON = utf8(JSON.stringify({ type: "webauthn.get", challenge: pk.challenge, origin, crossOrigin: false }));
    const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, c.key, concat(authenticatorData, await sha256(clientDataJSON))));
    return { id: c.id, rawId: c.id, type: "public-key", authenticatorAttachment: "platform", response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authenticatorData), signature: b64u(p1363ToDer(sig)), userHandle: c.userId } };
  }
  return { create, get, count: () => creds.size, clear: () => creds.clear() };
}
