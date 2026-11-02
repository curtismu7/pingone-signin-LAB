// The client side of pi.flow: what a BFF runs. Drives a flow through an injected fetchLike, keeps the cookie jar,
// and records a step-by-step trace [{n, title, request, response, note}] for the UI. Also a small CIBA client.
import { newVerifier, pkceChallenge, decodeJwt } from './jwt.js';
import { MT, GRANT_CIBA } from './op.js';
import { parseChallenge } from './stepup.js';
import { randomBytes } from 'node:crypto';
import { traceparentSource } from './traceparent.js';

const short = (v) => (v.length > 8 ? `${v.slice(0, 6)}…` : v);
const maskCookie = (s) => String(s).replace(/(^|;\s*)([^=;\s]+)=([^;]*)/g, (_m, p, k, v) => `${p}${k}=${short(v)}`);

// Records every call. `trace.call(title, {method, url, headers, body, note})` -> {status, headers, json, setCookies}.
export function createTracer(fetchLike) {
  const entries = [];
  const tp = traceparentSource(); // one trace per tracer; every hop gets its own span id
  async function call(title, { method = 'GET', url, headers: given = {}, body, note = '' }) {
    const headers = { ...given, traceparent: tp.next() };
    const sent = typeof body === 'string' ? body : body === undefined ? undefined : new URLSearchParams(body).toString();
    const r = await fetchLike(url, { method, headers, body: sent });
    const text = await r.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    const setCookies = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    const shownReq = { ...headers }; if (shownReq.cookie) shownReq.cookie = maskCookie(shownReq.cookie);
    let shownBody = sent;
    if (sent !== undefined && /json/.test(String(headers['content-type'] || ''))) { try { const o = JSON.parse(sent); if ('password' in o) o.password = '********'; shownBody = JSON.stringify(o); } catch { /* keep */ } }
    const shownRes = {};
    for (const k of ['content-type', 'www-authenticate', 'cache-control', 'traceparent']) if (r.headers.get(k)) shownRes[k] = r.headers.get(k);
    if (setCookies.length) shownRes['set-cookie'] = setCookies.map(maskCookie);
    entries.push({
      n: entries.length + 1, title,
      request: { method, url, headers: shownReq, ...(shownBody !== undefined ? { body: shownBody } : {}) },
      response: { status: r.status, headers: shownRes, body: json ?? text },
      note,
    });
    return { status: r.status, headers: r.headers, json, text, setCookies };
  }
  return { call, entries, traceId: tp.traceId };
}

export class PiFlowDriver {
  constructor({ fetchLike, baseUrl, clientId, redirectUri, tracer = createTracer(fetchLike), scope = 'openid' }) {
    this.baseUrl = baseUrl.replace(/\/+$/, ''); this.clientId = clientId; this.redirectUri = redirectUri; this.scope = scope;
    this.tracer = tracer; this.jar = {}; this.flow = null; this.pkce = null; this.code = null; this.state = null;
  }

  get trace() { return this.tracer.entries; }
  cookieHeader() { return Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; '); }
  #merge(setCookies) { for (const c of setCookies) { const [pair] = c.split(';'); const i = pair.indexOf('='); if (i > 0) this.jar[pair.slice(0, i).trim()] = pair.slice(i + 1); } }
  #hdrs(extra = {}) { const h = { accept: '*/*', ...extra }; const c = this.cookieHeader(); if (c) h.cookie = c; return h; }

  // Step 1. Opens a flow. `params` overrides/removes (value undefined) any authorize parameter, for negative tests.
  async authorize(params = {}) {
    this.pkce = { verifier: newVerifier(), state: randomBytes(9).toString('base64url'), nonce: randomBytes(9).toString('base64url') };
    const q = {
      client_id: this.clientId, redirect_uri: this.redirectUri, response_type: 'code', scope: this.scope, response_mode: 'pi.flow',
      code_challenge: pkceChallenge(this.pkce.verifier), code_challenge_method: 'S256', state: this.pkce.state, nonce: this.pkce.nonce, ...params,
    };
    for (const k of Object.keys(q)) if (q[k] === undefined) delete q[k];
    const note = q.response_mode === 'pi.flow' ? 'pi.flow: the answer is JSON, not a redirect. The cookie below binds the flow.' : 'No response_mode=pi.flow: expect a refusal. This lab has no redirect-based login.';
    const r = await this.tracer.call('Open the flow: GET /authorize', { url: `${this.baseUrl}/authorize?${new URLSearchParams(q)}`, headers: this.#hdrs(), note });
    this.#merge(r.setCookies);
    this.flow = r.status === 200 ? r.json : null;
    return r;
  }

  async submit(kind, body, note = '') {
    const titles = { password: 'Submit username and password', device: 'Choose a device', otp: 'Submit the one-time passcode' };
    const r = await this.tracer.call(`${titles[kind]}: POST /flows/{id}`, {
      method: 'POST', url: `${this.baseUrl}/flows/${this.flow?.id ?? 'none'}`, headers: this.#hdrs({ 'content-type': MT[kind] }), body: JSON.stringify(body),
      note: note || 'The session-token cookie rotates on every step; the driver merges the new one.',
    });
    this.#merge(r.setCookies);
    if (r.json && r.json.id && r.json.status) this.flow = r.json;
    return r;
  }

  async resume(note = '') {
    const r = await this.tracer.call('Resume: GET /as/resume?flowId=', {
      url: `${this.baseUrl}/as/resume?flowId=${this.flow?.id ?? 'none'}`, headers: this.#hdrs(),
      note: note || 'Needs the CURRENT session-token cookie (a lab rule, UNVERIFIED: a stale one is refused).',
    });
    this.#merge(r.setCookies);
    if (r.status === 200) { this.code = r.json.authorizeResponse.code; this.state = r.json.authorizeResponse.state; }
    return r;
  }

  async exchange({ code = this.code, verifier = this.pkce?.verifier, redirectUri = this.redirectUri, note = '' } = {}) {
    return this.tracer.call('Exchange the code: POST /token', {
      method: 'POST', url: `${this.baseUrl}/token`, headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri, client_id: this.clientId },
      note: note || 'The code is single use and bound to the PKCE challenge from step 1.',
    });
  }

  // Whole login. secrets: {username, passwords:[...] tried in order, deviceId, otp}. Stops at the first refusal.
  async run({ username, passwords = [], deviceId, otp, authorize = {} } = {}) {
    const a = await this.authorize(authorize);
    if (a.status !== 200) return { ok: false, outcome: 'refused', stage: 'authorize', error: a.json?.error, status: a.status };
    let last = null;
    for (const [i, pw] of passwords.entries()) {
      last = await this.submit('password', { username, password: pw }, i ? 'Retrying after a wrong password.' : '');
      if (last.status === 200) break;
      if (last.json?.error?.code === 'ACCOUNT_LOCKED') return { ok: false, outcome: 'locked', stage: 'password', error: 'ACCOUNT_LOCKED', status: last.status };
    }
    if (!last || last.status !== 200) return { ok: false, outcome: 'credentials_rejected', stage: 'password', error: last?.json?.details?.[0]?.code ?? last?.json?.error?.code, status: last?.status };
    if (this.flow.status === 'DEVICE_SELECTION_REQUIRED') {
      const pick = deviceId || this.flow._embedded.devices[0].id;
      const r = await this.submit('device', { device: { id: pick } });
      if (r.status !== 200) return { ok: false, outcome: 'refused', stage: 'device', error: r.json?.error?.code, status: r.status };
    }
    if (this.flow.status === 'OTP_REQUIRED') {
      const r = await this.submit('otp', { otp });
      if (r.status !== 200) return { ok: false, outcome: 'refused', stage: 'otp', error: r.json?.error?.code, status: r.status };
    }
    if (this.flow.status !== 'COMPLETED') return { ok: false, outcome: 'refused', stage: 'flow', error: this.flow.status };
    const rs = await this.resume();
    if (rs.status !== 200) return { ok: false, outcome: 'refused', stage: 'resume', error: rs.json?.code, status: rs.status };
    const t = await this.exchange();
    if (t.status !== 200) return { ok: false, outcome: 'refused', stage: 'token', error: t.json?.error, status: t.status };
    const claims = decodeJwt(t.json.id_token).payload;
    return { ok: true, outcome: 'signed_in', tokens: t.json, claims, nonceOk: claims.nonce === this.pkce.nonce, stateOk: this.state === this.pkce.state };
  }
}

// Minimal CIBA client over the same tracer.
export class CibaDriver {
  constructor({ fetchLike, baseUrl, clientId, tracer = createTracer(fetchLike) }) { this.baseUrl = baseUrl.replace(/\/+$/, ''); this.clientId = clientId; this.tracer = tracer; this.authReqId = null; }
  get trace() { return this.tracer.entries; }
  async start({ loginHint, bindingMessage, scope = 'openid', requestedExpiry } = {}) {
    const body = { client_id: this.clientId, scope, login_hint: loginHint };
    if (bindingMessage !== undefined) body.binding_message = bindingMessage;
    if (requestedExpiry !== undefined) body.requested_expiry = String(requestedExpiry);
    const r = await this.tracer.call('Start backchannel auth: POST /bc-authorize', {
      method: 'POST', url: `${this.baseUrl}/bc-authorize`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
      note: 'binding_message is limited to 8 characters in this mock.',
    });
    if (r.status === 200) this.authReqId = r.json.auth_req_id;
    return r;
  }
  poll(note = '') {
    return this.tracer.call('Poll the token endpoint: POST /token (CIBA grant)', {
      method: 'POST', url: `${this.baseUrl}/token`, headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: { grant_type: GRANT_CIBA, auth_req_id: this.authReqId, client_id: this.clientId }, note,
    });
  }
  phone(action, note = '') {
    return this.tracer.call(`Mock phone ${action}s: POST /phone/${action}`, {
      method: 'POST', url: `${this.baseUrl}/phone/${action}`, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ auth_req_id: this.authReqId }), note: note || 'Stands in for the user tapping the push notification.',
    });
  }
}

// Calls the mock resource server with a Bearer token. If the answer is an RFC 9470 challenge, returns it parsed.
export async function callResource(tracer, baseUrl, accessToken, { path = '/rs/transfer', method = 'POST', body = { amount: 25, to: 'acct-demo' }, note = '' } = {}) {
  const r = await tracer.call(`Call the resource: ${method} ${path}`, {
    method, url: `${baseUrl.replace(/\/+$/, '')}${path}`, headers: { authorization: `Bearer ${accessToken}`, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}), note,
  });
  return { ...r, challenge: r.status === 401 ? parseChallenge(r.headers.get('www-authenticate')) : null };
}
