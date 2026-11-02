// The client side of pi.flow, in the page: the part a BFF would run. Every call goes through the tracer.
// MOCK vendor content types and statuses. COMPLETED, GET /as/resume and INVALID_CREDENTIALS follow pingone-LAB (seen on a real PingOne run);
// the rest is modelled on the public sample apps, UNVERIFIED against a real PingOne.
import { newPkce } from "./pkce.js";
import { decodeJwt } from "./jwt.js";

export const BASE = "/mock";
export const MT = {
  password: "application/vnd.pingidentity.usernamePassword.check+json",
  device: "application/vnd.pingidentity.device.select+json",
  otp: "application/vnd.pingidentity.otp.check+json",
};
const TITLES = { password: "Submit username and password", device: "Choose a device", otp: "Submit the one-time passcode" };

export class PiFlowClient {
  constructor({ tracer, clientId = "lab-app", redirectUri, scope = "openid" }) {
    Object.assign(this, { tracer, clientId, redirectUri, scope });
    this.flow = null; this.pkce = null; this.code = null; this.state = null;
  }

  // Step 1. Always response_mode=pi.flow: this page has no redirect-based login.
  async authorize(extra = {}) {
    this.pkce = await newPkce(); this.flow = null; this.code = null;
    const q = {
      client_id: this.clientId, redirect_uri: this.redirectUri, response_type: "code", scope: this.scope, response_mode: "pi.flow",
      code_challenge: this.pkce.challenge, code_challenge_method: "S256", state: this.pkce.state, nonce: this.pkce.nonce, ...extra,
    };
    const r = await this.tracer.call("Open the flow: GET /authorize?response_mode=pi.flow", {
      path: `${BASE}/authorize?${new URLSearchParams(q)}`, sendsCookie: false,
      note: "pi.flow: the answer is JSON, not a redirect. The ST cookie it sets binds the flow to this browser.",
    });
    this.flow = r.status === 200 ? r.json : null;
    return r;
  }

  async submit(kind, body, note = "") {
    const r = await this.tracer.call(`${TITLES[kind]}: POST /flows/{id}`, {
      method: "POST", path: `${BASE}/flows/${this.flow?.id ?? "none"}`, headers: { "content-type": MT[kind] }, body: JSON.stringify(body),
      note: note || "Lab invention (UNVERIFIED against PingOne): the session-token cookie rotates on every step. Compare the set-cookie preview of this call with the one before.",
    });
    if (r.json && r.json.id && r.json.status) this.flow = r.json;
    return r;
  }

  async resume(note = "") {
    const r = await this.tracer.call("Resume: GET /as/resume?flowId=", {
      path: `${BASE}/as/resume?flowId=${this.flow?.id ?? "none"}`,
      note: note || "Needs the CURRENT session-token cookie (a lab rule, UNVERIFIED). UNVERIFIED: a real PingOne may answer with a redirect instead of this JSON (authorizeResponse is pingone-LAB's mock shape).",
    });
    if (r.status === 200) { this.code = r.json.authorizeResponse.code; this.state = r.json.authorizeResponse.state; }
    return r;
  }

  async exchange(note = "") {
    return this.tracer.call("Exchange the code: POST /token", {
      method: "POST", path: `${BASE}/token`, headers: { "content-type": "application/x-www-form-urlencoded" }, sendsCookie: false,
      body: new URLSearchParams({ grant_type: "authorization_code", code: this.code, code_verifier: this.pkce.verifier, redirect_uri: this.redirectUri, client_id: this.clientId }).toString(),
      note: note || "The code is single use and bound to the PKCE challenge from step 1.",
    });
  }

  // What the page shows after a successful exchange.
  tokenResult(json) {
    const id = decodeJwt(json.id_token); const access = decodeJwt(json.access_token);
    return { tokens: json, id, access, nonceOk: id?.payload?.nonce === this.pkce.nonce, stateOk: this.state === this.pkce.state };
  }

  // Whole login in one go (used by the Step-up tab). Stops at the first refusal.
  async run({ username, password, deviceId, otp, authorize = {} }) {
    const a = await this.authorize(authorize);
    if (a.status !== 200) return { ok: false, stage: "authorize", error: a.json?.error_description || a.json?.error || `HTTP ${a.status}` };
    const p = await this.submit("password", { username, password });
    if (p.status !== 200) return { ok: false, stage: "password", error: p.json?.error?.message || p.json?.message || `HTTP ${p.status}` };
    if (this.flow.status === "DEVICE_SELECTION_REQUIRED") {
      const d = await this.submit("device", { device: { id: deviceId || this.flow._embedded.devices[0].id } });
      if (d.status !== 200) return { ok: false, stage: "device", error: d.json?.error?.message || `HTTP ${d.status}` };
    }
    if (this.flow.status === "OTP_REQUIRED") {
      const o = await this.submit("otp", { otp });
      if (o.status !== 200) return { ok: false, stage: "otp", error: o.json?.error?.message || `HTTP ${o.status}` };
    }
    if (this.flow.status !== "COMPLETED") return { ok: false, stage: "flow", error: `unexpected status ${this.flow.status}` };
    const r = await this.resume();
    if (r.status !== 200) return { ok: false, stage: "resume", error: r.json?.message || `HTTP ${r.status}` };
    const t = await this.exchange();
    if (t.status !== 200) return { ok: false, stage: "token", error: t.json?.error_description || `HTTP ${t.status}` };
    return { ok: true, ...this.tokenResult(t.json) };
  }
}

// One call to the mock resource server. A 401 carries the parsed RFC 9470 challenge in `challenge`.
export async function callResource(tracer, accessToken, { path = "/rs/transfer", method = "POST", body = { amount: 25, to: "acct-demo" }, note = "" } = {}, parse) {
  const r = await tracer.call(`Call the resource: ${method} ${path}`, {
    method, path: `${BASE}${path}`, sendsCookie: false,
    headers: { authorization: `Bearer ${accessToken}`, ...(method === "POST" ? { "content-type": "application/json" } : {}) },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}), note,
  });
  return { ...r, challenge: r.status === 401 ? parse(r.headers?.get("www-authenticate")) : null };
}
