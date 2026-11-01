// Records every call the page makes to the mock, in the same shape the server's scenario runner uses:
// {n, title, request:{method,url,headers,body}, response:{status,headers,body}, note}.
// The session-token cookie is HttpOnly, so the page can not read it. The server sends a shortened copy in X-Mock-Cookie-Preview
// (the same shortening it uses in its own traces) and that is the only form of it shown here. Passwords are masked.
import { traceparentSource } from "./traceparent.js";

const KEEP = ["content-type", "www-authenticate", "cache-control", "traceparent"];

export function createTracer(onChange = () => {}) {
  const entries = [];
  let tp = traceparentSource(); // one trace per run (clear() starts a new one); a new span id for every hop
  let epoch = 0; // bumped by clear(): an answer that arrives after a clear belongs to a run that is gone and is not recorded
  let cookie = null; // the shortened ST value from the last response, e.g. "ST=2NlQnH…"

  async function call(title, { method = "GET", path, headers = {}, body, note = "", sendsCookie = true }) {
    const mine = epoch;
    headers = { ...headers, traceparent: tp.next() };
    const shownHeaders = { ...headers };
    if (sendsCookie && cookie) shownHeaders.cookie = `${cookie} (sent by the browser; HttpOnly)`;
    let shownBody = body;
    if (typeof body === "string" && /json/.test(String(headers["content-type"] || ""))) {
      try { const o = JSON.parse(body); if ("password" in o) o.password = "********"; shownBody = JSON.stringify(o); } catch { /* keep */ }
    }
    let status = 0; let text = ""; let res = null;
    try {
      res = await fetch(path, { method, headers, body, credentials: "same-origin" });
      status = res.status; text = await res.text();
    } catch (e) { text = JSON.stringify({ error: "network_error", message: String(e?.message || e) }); }
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (mine !== epoch) return { status, headers: res?.headers, json, text, stale: true };
    const resHeaders = {};
    if (res) for (const k of KEEP) if (res.headers.get(k)) resHeaders[k] = res.headers.get(k);
    const preview = res?.headers.get("x-mock-cookie-preview")?.replace(/\.\.\./g, "…");
    if (preview) { resHeaders["set-cookie"] = [`${preview} (HttpOnly; shortened by the server)`]; cookie = preview.split(", ")[0]; }
    entries.push({
      n: entries.length + 1, title,
      request: { method, url: path, headers: shownHeaders, ...(shownBody !== undefined ? { body: shownBody } : {}) },
      response: { status, headers: resHeaders, body: json ?? text },
      note,
    });
    onChange([...entries]);
    return { status, headers: res?.headers, json, text };
  }
  return { call, entries, clear() { epoch += 1; tp = traceparentSource(); entries.length = 0; cookie = null; onChange([]); }, get cookie() { return cookie; } };
}

// "GET /path?x HTTP/1.1" style text for the Raw tab.
export function rawMessage(entry) {
  const u = String(entry.request.url).replace(/^https?:\/\/[^/]+/, "");
  const reqHead = [`${entry.request.method} ${u} HTTP/1.1`, ...Object.entries(entry.request.headers || {}).map(([k, v]) => `${k}: ${v}`)].join("\n");
  const req = entry.request.body !== undefined ? `${reqHead}\n\n${entry.request.body}` : reqHead;
  const h = entry.response.headers || {};
  const resHead = [`HTTP/1.1 ${entry.response.status}`, ...Object.entries(h).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => `${k}: ${x}`) : [`${k}: ${v}`]))].join("\n");
  const b = entry.response.body;
  return { request: req, response: `${resHead}\n\n${typeof b === "string" ? b : JSON.stringify(b, null, 2)}` };
}
