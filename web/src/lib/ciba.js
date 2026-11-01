// CIBA client and the mock phone, through the tracer. Everything here is MOCK: the 8 character binding_message limit, the
// +5 s slow_down step and the phone endpoints are this lab's own values, UNVERIFIED against a real PingOne.
import { BASE } from "./flow.js";
import { pageTraceparent } from "./traceparent.js";

const form = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")).toString();
const FORM = { "content-type": "application/x-www-form-urlencoded" };

export function cibaStart(tracer, { clientId = "lab-app", loginHint, bindingMessage, requestedExpiry }) {
  return tracer.call("Start backchannel auth: POST /bc-authorize", {
    method: "POST", path: `${BASE}/bc-authorize`, headers: FORM, sendsCookie: false,
    body: form({ client_id: clientId, scope: "openid", login_hint: loginHint, binding_message: bindingMessage, requested_expiry: requestedExpiry }),
    note: "MOCK: binding_message is limited to 8 characters in this lab (UNVERIFIED against a real tenant).",
  });
}
export function cibaPoll(tracer, { clientId = "lab-app", authReqId }) {
  return tracer.call("Poll the token endpoint: POST /token (CIBA grant)", {
    method: "POST", path: `${BASE}/token`, headers: FORM, sendsCookie: false,
    body: form({ grant_type: "urn:openid:params:grant-type:ciba", auth_req_id: authReqId, client_id: clientId }),
    note: "Polling faster than the interval earns slow_down.",
  });
}
export function phoneDecide(tracer, action, authReqId) {
  return tracer.call(`Mock phone ${action}s: POST /phone/${action}`, {
    method: "POST", path: `${BASE}/phone/${action}`, headers: { "content-type": "application/json" }, sendsCookie: false,
    body: JSON.stringify({ auth_req_id: authReqId }), note: "MOCK: stands in for the user tapping the push notification on their device.",
  });
}
// Not traced: the phone watching for notifications is background noise, not part of the protocol.
export async function phonePending(loginHint) {
  const r = await fetch(`${BASE}/phone/pending?login_hint=${encodeURIComponent(loginHint)}`, { headers: { traceparent: pageTraceparent() } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()).pending;
}
