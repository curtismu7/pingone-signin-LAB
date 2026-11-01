// The mock PingOne, as one pure object: handle({method, path, query, headers, body, baseUrl}) -> {status, headers, body}.
// No sockets, no express. Authorization-endpoint login is pi.flow ONLY; there is no redirect-based login path.
// Everything about real PingOne behaviour marked UNVERIFIED in docs/architecture.md is a guess, not a claim.
import { randomBytes } from 'node:crypto';
import { newKey, signJwt, verifyJwt, safeEqual, pkceChallenge } from './jwt.js';
import { ACR, buildChallenge, stepUpNeeded } from './stepup.js';
import { CLIENTS, DEFAULTS, MOCK_OTP, USERS } from './seed.js';
import { replyTraceparent } from './traceparent.js';

export const FLOW_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
export const MT = Object.freeze({
  password: 'application/vnd.pingidentity.usernamePassword.check+json',
  device: 'application/vnd.pingidentity.device.select+json',
  otp: 'application/vnd.pingidentity.otp.check+json',
});
export const GRANT_CIBA = 'urn:openid:params:grant-type:ciba';
export const COOKIE_NAME = 'ST';

const own = (o, k) => (typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const id = () => randomBytes(16).toString('base64url');
const str = (v, max = 256) => typeof v === 'string' && v.length > 0 && v.length <= max;
const res = (status, body, headers = {}) => ({ status, headers, body });
const oauthErr = (status, error, description, headers) => res(status, { error, error_description: description }, headers);
const flowErr = (status, code, message, extra = {}) => res(status, { code, message, ...extra });

function mediaType(h) { return String(h || '').split(';')[0].trim().toLowerCase(); }
function cookieOf(headers) {
  for (const part of String(headers?.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE_NAME) return part.slice(i + 1).trim();
  }
  return '';
}
const setCookie = (v) => `${COOKIE_NAME}=${v}; Path=/; HttpOnly; SameSite=Lax`;

export function createMockOP({ now = Date.now, config = {}, users = USERS, clients = CLIENTS, random = id } = {}) {
  const cfg = { ...DEFAULTS, ...config };
  const secs = () => Math.floor(now() / 1000);
  let st;
  function reset() { st = { key: newKey(), flows: new Map(), codes: new Map(), cibas: new Map(), locks: new Map() }; }
  reset();

  function prune() {
    const cut = now() - 3_600_000;
    for (const m of [st.flows, st.codes, st.cibas]) for (const [k, v] of m) if (v.expiresAt < cut) m.delete(k);
  }

  // ---- tokens ----
  function mint({ user, client, scope, nonce, acr, amr, authTime }) {
    const iat = secs();
    const base = { iss: cfg.issuer, sub: user.sub, iat, auth_time: Math.floor(authTime / 1000), acr, amr, mock: true };
    const idToken = signJwt({ ...base, aud: client, exp: iat + cfg.idTtlS, name: user.name, ...(nonce ? { nonce } : {}) }, st.key, 'JWT');
    const accessToken = signJwt({ ...base, aud: cfg.rsAudience, client_id: client, scope, jti: random(), exp: iat + cfg.accessTtlS }, st.key, 'at+jwt');
    return { token_type: 'Bearer', access_token: accessToken, id_token: idToken, expires_in: cfg.accessTtlS, scope };
  }

  // ---- GET /authorize ----
  function authorize(q) {
    if (q.response_mode !== 'pi.flow') {
      return oauthErr(400, 'invalid_request', 'redirect-based login is not supported: this lab signs in with pi.flow only. Send response_mode=pi.flow.');
    }
    if (Object.entries(q).some(([k, v]) => k !== '__base' && typeof v !== 'string')) return oauthErr(400, 'invalid_request', 'every parameter must be a single string (no repeated or nested parameters)');
    const client = own(clients, q.client_id);
    if (!client) return oauthErr(400, 'invalid_client', 'unknown client_id');
    if (!client.redirectUris.includes(q.redirect_uri)) return oauthErr(400, 'invalid_request', 'redirect_uri is not registered for this client');
    if (q.response_type !== 'code') return oauthErr(400, 'unsupported_response_type', 'response_type must be code');
    if (!String(q.scope || '').split(' ').includes('openid')) return oauthErr(400, 'invalid_scope', 'scope must include openid');
    if (q.code_challenge_method !== 'S256') return oauthErr(400, 'invalid_request', 'PKCE is required: code_challenge_method must be S256');
    if (!/^[A-Za-z0-9_-]{43}$/.test(String(q.code_challenge || ''))) return oauthErr(400, 'invalid_request', 'PKCE is required: code_challenge must be a 43-character base64url S256 value');
    if (!str(q.state)) return oauthErr(400, 'invalid_request', 'state is required');
    if (!str(q.nonce)) return oauthErr(400, 'invalid_request', 'nonce is required');
    if (q.login_hint !== undefined && !str(q.login_hint, 128)) return oauthErr(400, 'invalid_request', 'login_hint must be a short string');
    let acrValues = [];
    if (q.acr_values !== undefined) {
      acrValues = String(q.acr_values).split(' ').filter(Boolean);
      if (!acrValues.length || acrValues.some((a) => !Object.values(ACR).includes(a))) return oauthErr(400, 'invalid_request', `unknown mock acr in acr_values (known: ${Object.values(ACR).join(', ')})`);
    }
    let maxAge = null;
    if (q.max_age !== undefined) {
      if (!/^\d{1,7}$/.test(String(q.max_age))) return oauthErr(400, 'invalid_request', 'max_age must be a non-negative integer');
      maxAge = Number(q.max_age);
    }
    prune();
    const f = {
      id: random(), client: q.client_id, redirectUri: q.redirect_uri, scope: q.scope, state: q.state, nonce: q.nonce, challenge: q.code_challenge,
      loginHint: q.login_hint || null, acrValues, maxAge, status: 'USERNAME_PASSWORD_REQUIRED', cookie: random(), user: null,
      amr: [], authTime: null, deviceId: null, otpFails: 0, fails: 0, createdAt: now(), expiresAt: now() + cfg.flowTtlS * 1000,
    };
    st.flows.set(f.id, f);
    return res(200, view(f, q.__base), { 'set-cookie': [setCookie(f.cookie)] });
  }

  function view(f, base, extra = {}) {
    const self = `${base}/flows/${f.id}`;
    const body = { id: f.id, status: f.status, expiresAt: new Date(f.expiresAt).toISOString(), _links: { self: { href: self } }, ...extra };
    if (f.status === 'USERNAME_PASSWORD_REQUIRED') body._links['usernamePassword.check'] = { href: self };
    if (f.status === 'DEVICE_SELECTION_REQUIRED') {
      body._links['device.select'] = { href: self };
      body._embedded = { devices: users[f.user].devices.map(({ id: did, type, label }) => ({ id: did, type, label })) };
    }
    if (f.status === 'OTP_REQUIRED') body._links['otp.check'] = { href: self };
    if (f.status === 'RESUME_REQUIRED') { body.resumeUrl = `${base}/resume?flowId=${f.id}`; body._links.resume = { href: body.resumeUrl }; }
    return body;
  }

  // Shared front matter of every /flows and /resume call: id shape, existence, expiry, session-token cookie.
  function loadFlow(flowId, headers) {
    if (!FLOW_ID_RE.test(String(flowId))) return { err: flowErr(400, 'INVALID_FLOW_ID', 'flow id is malformed') };
    const f = st.flows.get(flowId);
    if (!f) return { err: flowErr(404, 'NOT_FOUND', 'unknown flow') };
    if (now() >= f.expiresAt) return { err: flowErr(400, 'FLOW_EXPIRED', 'the flow has expired; start a new authorization request') };
    if (f.status === 'COMPLETED' || f.status === 'FAILED') return { err: flowErr(400, f.status === 'COMPLETED' ? 'FLOW_ALREADY_COMPLETED' : 'FLOW_FAILED', `the flow is ${f.status}; flows are single use`) };
    const c = cookieOf(headers);
    if (!c || !safeEqual(c, f.cookie)) return { err: flowErr(401, 'INVALID_SESSION_TOKEN', 'Session token cookie value does not match the flow') };
    return { f };
  }

  const rotate = (f) => { f.cookie = random(); return { 'set-cookie': [setCookie(f.cookie)] }; };

  function lockState(name) {
    const key = name.trim().toLowerCase();
    let l = st.locks.get(key);
    if (!l) {
      l = { fails: 0, until: 0 };
      if (st.locks.size >= cfg.maxLockEntries) st.locks.delete(st.locks.keys().next().value); // bounded: evict the oldest
      st.locks.set(key, l);
    }
    if (l.until && now() >= l.until) { l.until = 0; l.fails = 0; }
    return l;
  }

  // ---- POST /flows/:id ----
  function postFlow(flowId, req, base) {
    const r = req.headers || {};
    if (mediaType(r.accept) === 'application/json') return flowErr(406, 'NOT_ACCEPTABLE', 'Accept must allow application/vnd.pingidentity.*+json');
    const kind = Object.keys(MT).find((k) => MT[k].toLowerCase() === mediaType(r['content-type']));
    if (!kind) return flowErr(415, 'UNSUPPORTED_MEDIA_TYPE', `use one of the vnd.pingidentity content types, e.g. ${MT.password}`);
    const { f, err } = loadFlow(flowId, r);
    if (err) return err;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const out = (extra, status = 200) => res(status, view(f, base, extra), rotate(f));
    const fail = (status, code, message, extra = {}) => res(status, view(f, base, { error: { code, message }, ...extra }), rotate(f));

    if (f.status === 'USERNAME_PASSWORD_REQUIRED' && kind === 'password') {
      if (!str(body.username, 128) || typeof body.password !== 'string' || body.password.length > 256) return fail(400, 'INVALID_REQUEST', 'username and password are required');
      const lock = lockState(body.username);
      const attempts = () => ({ attempts: { used: lock.fails, max: cfg.maxAttempts, remaining: Math.max(0, cfg.maxAttempts - lock.fails) } });
      if (lock.until) return fail(400, 'ACCOUNT_LOCKED', `account is locked for ${Math.ceil((lock.until - now()) / 1000)}s after ${cfg.maxAttempts} failed attempts`, attempts());
      const user = own(users, body.username.trim().toLowerCase());
      if (!user || !safeEqual(user.password, body.password)) {
        lock.fails += 1;
        if (lock.fails >= cfg.maxAttempts) { lock.until = now() + cfg.lockoutS * 1000; return fail(400, 'ACCOUNT_LOCKED', `account is locked for ${cfg.lockoutS}s after ${cfg.maxAttempts} failed attempts`, attempts()); }
        return fail(400, 'INVALID_CREDENTIALS', 'the username or password is incorrect', attempts());
      }
      lock.fails = 0;
      const name = body.username.trim().toLowerCase();
      f.user = name; f.authTime = now(); f.amr = ['pwd'];
      const wantsMulti = f.acrValues.length > 0 && !f.acrValues.includes(ACR.single);
      if ((user.mfa || wantsMulti) && user.devices.length === 0) { f.status = 'FAILED'; return out({ error: { code: 'NO_MFA_DEVICE', message: 'a stronger authentication was required but the user has no device' } }, 400); }
      if (user.mfa || wantsMulti) {
        if (user.devices.length > 1) f.status = 'DEVICE_SELECTION_REQUIRED';
        else { f.deviceId = user.devices[0].id; f.status = 'OTP_REQUIRED'; }
      } else f.status = 'RESUME_REQUIRED';
      return out();
    }
    if (f.status === 'DEVICE_SELECTION_REQUIRED' && kind === 'device') {
      const dev = users[f.user].devices.find((d) => d.id === body?.device?.id);
      if (!dev) return fail(400, 'INVALID_DEVICE', 'choose one of the listed devices');
      f.deviceId = dev.id; f.status = 'OTP_REQUIRED';
      return out();
    }
    if (f.status === 'OTP_REQUIRED' && kind === 'otp') {
      if (typeof body.otp !== 'string' || !safeEqual(MOCK_OTP, body.otp)) {
        f.otpFails += 1;
        if (f.otpFails >= cfg.otpAttempts) { f.status = 'FAILED'; return out({ error: { code: 'OTP_ATTEMPTS_EXCEEDED', message: 'too many wrong one-time passcodes; the flow is closed' } }, 400); }
        return fail(400, 'OTP_INVALID', 'the one-time passcode is incorrect', { attempts: { used: f.otpFails, max: cfg.otpAttempts, remaining: cfg.otpAttempts - f.otpFails } });
      }
      f.amr = ['pwd', 'otp', 'mfa']; f.status = 'RESUME_REQUIRED';
      return out();
    }
    return fail(400, 'UNEXPECTED_STEP', `the flow is at ${f.status}; that content type does not apply`);
  }

  function getFlow(flowId, req, base) {
    const { f, err } = loadFlow(flowId, req.headers || {});
    return err || res(200, view(f, base));
  }

  // ---- GET /resume?flowId= ----
  function resume(q, req, base) {
    const { f, err } = loadFlow(q.flowId, req.headers || {});
    if (err) return err;
    if (f.status !== 'RESUME_REQUIRED') return flowErr(400, 'NOT_READY', `the flow is at ${f.status}, not RESUME_REQUIRED`);
    const code = randomBytes(24).toString('base64url');
    const mfa = f.amr.includes('mfa');
    st.codes.set(code, {
      flowId: f.id, client: f.client, redirectUri: f.redirectUri, challenge: f.challenge, nonce: f.nonce, scope: f.scope, user: f.user,
      acr: mfa ? ACR.multi : ACR.single, amr: f.amr, authTime: f.authTime, expiresAt: now() + cfg.codeTtlS * 1000, used: false,
    });
    f.status = 'COMPLETED';
    // UNVERIFIED: the real /resume may answer with a redirect rather than JSON. The mock answers 200 JSON for the BFF to read.
    return res(200, { id: f.id, status: 'COMPLETED', code, state: f.state, redirect_uri: f.redirectUri }, rotate(f));
  }

  // ---- POST /token ----
  const notFlat = (b) => Object.values(b).some((v) => v !== null && typeof v === 'object');
  function token(b) {
    if (notFlat(b)) return oauthErr(400, 'invalid_request', 'every parameter must be a single value');
    if (b.grant_type === GRANT_CIBA) return cibaToken(b);
    if (b.grant_type !== 'authorization_code') return oauthErr(400, 'unsupported_grant_type', 'grant_type must be authorization_code or the CIBA grant');
    const c = str(b.code, 256) ? st.codes.get(b.code) : null;
    if (!c) return oauthErr(400, 'invalid_grant', 'unknown authorization code');
    if (c.used) return oauthErr(400, 'invalid_grant', 'authorization code was already used');
    c.used = true; // burned on the first try, right or wrong
    if (now() >= c.expiresAt) return oauthErr(400, 'invalid_grant', 'authorization code has expired');
    if (b.client_id !== c.client) return oauthErr(400, 'invalid_grant', 'code was issued to a different client');
    if (b.redirect_uri !== c.redirectUri) return oauthErr(400, 'invalid_grant', 'redirect_uri does not match the authorization request');
    if (!str(b.code_verifier, 128) || !safeEqual(pkceChallenge(b.code_verifier), c.challenge)) return oauthErr(400, 'invalid_grant', 'PKCE verification failed: code_verifier does not match the code_challenge');
    return res(200, mint({ user: users[c.user], client: c.client, scope: c.scope, nonce: c.nonce, acr: c.acr, amr: c.amr, authTime: c.authTime }), { 'cache-control': 'no-store' });
  }

  // ---- CIBA ----
  function bcAuthorize(b) {
    if (notFlat(b)) return oauthErr(400, 'invalid_request', 'every parameter must be a single value');
    const client = own(clients, b.client_id);
    if (!client) return oauthErr(400, 'invalid_client', 'unknown client_id');
    if (!String(b.scope || '').split(' ').includes('openid')) return oauthErr(400, 'invalid_scope', 'scope must include openid');
    if (!str(b.login_hint, 128)) return oauthErr(400, 'invalid_request', 'login_hint is required');
    const user = own(users, b.login_hint.trim().toLowerCase());
    if (!user) return oauthErr(400, 'unknown_user_id', 'login_hint does not identify a user');
    if (b.binding_message !== undefined) {
      if (typeof b.binding_message !== 'string' || [...b.binding_message].length > cfg.bindingMax || /[\u0000-\u001f\u007f]/.test(b.binding_message)) {
        return oauthErr(400, 'invalid_binding_message', `binding_message must be at most ${cfg.bindingMax} characters (a mock limit, UNVERIFIED against a real tenant)`);
      }
    }
    let expiry = cfg.cibaExpiryS;
    if (b.requested_expiry !== undefined) {
      expiry = Number(b.requested_expiry);
      if (!Number.isInteger(expiry) || expiry < 1 || expiry > cfg.cibaMaxExpiryS) return oauthErr(400, 'invalid_request', `requested_expiry must be 1-${cfg.cibaMaxExpiryS}`);
    }
    prune();
    const rec = { id: random(), client: b.client_id, user: b.login_hint.trim().toLowerCase(), scope: b.scope, binding: b.binding_message || '', state: 'pending', interval: cfg.cibaIntervalS, lastPoll: null, createdAt: now(), expiresAt: now() + expiry * 1000, decidedAt: null, redeemed: false };
    st.cibas.set(rec.id, rec);
    return res(200, { auth_req_id: rec.id, expires_in: expiry, interval: rec.interval });
  }

  function cibaToken(b) {
    const c = str(b.auth_req_id, 64) ? st.cibas.get(b.auth_req_id) : null;
    if (!c || c.client !== b.client_id) return oauthErr(400, 'invalid_grant', 'unknown auth_req_id');
    if (c.redeemed) return oauthErr(400, 'invalid_grant', 'auth_req_id was already redeemed');
    if (now() >= c.expiresAt) return oauthErr(400, 'expired_token', 'the authentication request has expired');
    const tooFast = c.lastPoll !== null && now() - c.lastPoll < c.interval * 1000;
    c.lastPoll = now();
    if (tooFast) { c.interval += 5; return oauthErr(400, 'slow_down', `polling too fast; interval is now ${c.interval}s`, {}); }
    if (c.state === 'pending') return oauthErr(400, 'authorization_pending', 'the user has not responded yet');
    if (c.state === 'denied') return oauthErr(400, 'access_denied', 'the user denied the request');
    c.redeemed = true;
    return res(200, mint({ user: users[c.user], client: c.client, scope: c.scope, acr: ACR.single, amr: ['ciba'], authTime: c.decidedAt }), { 'cache-control': 'no-store' });
  }

  // ---- mock phone ----
  function phone(method, sub, req) {
    if (method === 'GET' && sub === 'pending') {
      const who = String(req.query?.login_hint || '').trim().toLowerCase();
      const list = [...st.cibas.values()].filter((c) => c.state === 'pending' && now() < c.expiresAt && (!who || c.user === who))
        .map((c) => ({ auth_req_id: c.id, user: c.user, client: c.client, binding_message: c.binding, expires_in: Math.ceil((c.expiresAt - now()) / 1000) }));
      return res(200, { pending: list });
    }
    if (method === 'POST' && (sub === 'approve' || sub === 'deny')) {
      const aid = req.body?.auth_req_id;
      if (!FLOW_ID_RE.test(String(aid))) return oauthErr(400, 'invalid_request', 'auth_req_id is malformed');
      const c = st.cibas.get(aid);
      if (!c) return oauthErr(404, 'invalid_request', 'unknown auth_req_id');
      if (now() >= c.expiresAt) return oauthErr(400, 'expired_token', 'the authentication request has expired');
      if (c.state !== 'pending') return oauthErr(409, 'invalid_request', `already ${c.state}`);
      c.state = sub === 'approve' ? 'approved' : 'denied'; c.decidedAt = now();
      return res(200, { auth_req_id: c.id, state: c.state });
    }
    return flowErr(404, 'NOT_FOUND', 'unknown phone endpoint');
  }

  // ---- resource server ----
  function bearer(headers) { const m = /^Bearer\s+(\S+)$/i.exec(String(headers?.authorization || '')); return m ? m[1] : null; }
  function rs(method, sub, req) {
    const t = bearer(req.headers);
    if (!t) return res(401, { error: 'invalid_request', error_description: 'a Bearer access token is required' }, { 'www-authenticate': 'Bearer realm="mock-rs"' });
    const v = verifyJwt(t, st.key, { now });
    if (!v.ok || v.header.typ !== 'at+jwt' || v.payload.aud !== cfg.rsAudience || v.payload.iss !== cfg.issuer) {
      return res(401, { error: 'invalid_token', error_description: `token refused (${v.ok ? 'wrong type, audience or issuer' : v.reason})` }, { 'www-authenticate': 'Bearer realm="mock-rs", error="invalid_token"' });
    }
    if (sub === 'balance' && method === 'GET') return res(200, { balance: 1250, currency: 'USD', acr: v.payload.acr, mock: true });
    if (sub === 'transfer' && method === 'POST') {
      const need = stepUpNeeded(v.payload, { requireAcr: cfg.rsRequireAcr, maxAgeS: cfg.rsMaxAgeS, nowMs: now() });
      if (need) return res(401, { error: 'insufficient_user_authentication', error_description: need.description }, { 'www-authenticate': buildChallenge(need) });
      const { amount, to } = req.body || {};
      if (!(typeof amount === 'number' && amount > 0 && amount < 1e9) || !str(to, 64)) return res(400, { error: 'invalid_request', error_description: 'amount (number) and to (string) are required' });
      return res(200, { transferred: true, amount, to, acr: v.payload.acr, auth_age_s: secs() - v.payload.auth_time, mock: true });
    }
    return flowErr(404, 'NOT_FOUND', 'unknown resource');
  }

  // ---- router ----
  const safeDecode = (v) => { try { return decodeURIComponent(v); } catch { return ''; } };
  function route(req) {
    const method = String(req.method || 'GET').toUpperCase();
    const path = String(req.path || '/').replace(/\/+$/, '') || '/';
    const base = String(req.baseUrl || cfg.baseUrl).replace(/\/+$/, '');
    const query = req.query || {}; const body = req.body && typeof req.body === 'object' ? req.body : {};
    let m;
    if (path === '/authorize') return method === 'GET' ? authorize({ ...query, __base: base }) : flowErr(405, 'METHOD_NOT_ALLOWED', 'GET only', {});
    if ((m = /^\/flows\/([^/]+)$/.exec(path))) {
      if (method === 'POST') return postFlow(safeDecode(m[1]), req, base);
      if (method === 'GET') return getFlow(safeDecode(m[1]), req, base);
      return flowErr(405, 'METHOD_NOT_ALLOWED', 'GET or POST');
    }
    if (path === '/resume') return method === 'GET' ? resume(query, req, base) : flowErr(405, 'METHOD_NOT_ALLOWED', 'GET only');
    if (path === '/token') return method === 'POST' ? token(body) : flowErr(405, 'METHOD_NOT_ALLOWED', 'POST only');
    if (path === '/bc-authorize') return method === 'POST' ? bcAuthorize(body) : flowErr(405, 'METHOD_NOT_ALLOWED', 'POST only');
    if ((m = /^\/phone\/([a-z]+)$/.exec(path))) return phone(method, m[1], req);
    if ((m = /^\/rs\/([a-z]+)$/.exec(path))) return rs(method, m[1], req);
    return flowErr(404, 'NOT_FOUND', 'unknown mock endpoint');
  }

  // handle() never throws: anything unexpected is a clean 500.
  // A valid inbound traceparent is answered with the same trace id and a new span id (W3C Trace Context); a bad one is ignored.
  function handle(req) {
    let out;
    try { out = route(req); } catch { out = flowErr(500, 'INTERNAL_ERROR', 'unexpected error in the mock'); }
    try {
      const tp = replyTraceparent(req?.headers?.traceparent);
      if (tp) out = { ...out, headers: { ...out.headers, traceparent: tp } };
    } catch { /* tracing never breaks a request */ }
    return out;
  }

  return { handle, reset, config: cfg, verifyAccess: (t) => verifyJwt(t, st.key, { now }), _state: () => st };
}
