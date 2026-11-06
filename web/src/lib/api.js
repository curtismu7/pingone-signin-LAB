import { pageTraceparent } from "./traceparent.js";

// Same origin only: every URL is a path. Errors the mock answers with (4xx) are normal responses for the tracer; these helpers are for /api.
export async function getJson(path) {
  const r = await fetch(path, { headers: { traceparent: pageTraceparent() } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
export async function postJson(path, body = {}) {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json", traceparent: pageTraceparent() }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || `HTTP ${r.status}`);
  return data;
}
export const getCatalog = (vertical) => getJson(`/api/catalog${vertical ? `?vertical=${encodeURIComponent(vertical)}` : ""}`);
// Rule 19: the server-side Mock/Real toggle. Never throws on 409: the header shows the server's reason.
export const getModeInfo = () => fetch("/api/info", { headers: { traceparent: pageTraceparent() } }).then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) }));
export const postMode = (source) => fetch("/api/mode", { method: "POST", headers: { "content-type": "application/json", traceparent: pageTraceparent() }, body: JSON.stringify({ source }) }).then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) }));
export const resetLab = () => postJson("/api/reset");
export const runScenario = (scenario, vertical) => postJson("/api/run", { scenario, vertical });
export const runAll = (vertical) => postJson("/api/run-all", { vertical });
