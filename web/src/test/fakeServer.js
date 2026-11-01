// The real Express app (real mock PingOne, real scenario runner) on a loopback port, with a clock the tests control and a
// browser-like fetch: relative URLs, a cookie jar, an Origin header. The page code under test is unchanged.
import { createMockOP } from "../../../core/src/index.js";
import { createApp, startHttpServer } from "../../../server/src/app.js";
import { createHealth } from "../../../server/src/health.js";

export async function startFakeServer() {
  const clock = { t: Date.now() };
  const op = createMockOP({ now: () => clock.t });
  const health = createHealth({ intervalMs: 3_600_000 });
  await health.ready;
  const { server, url } = await startHttpServer({ port: 0, host: "127.0.0.1", app: createApp({ health, op, webDist: "/nonexistent" }) });
  const base = url.replace(/\/$/, "");
  const realFetch = globalThis.fetch;
  const state = { jar: {}, calls: [], intercept: null };

  globalThis.fetch = async (input, init = {}) => {
    const path = String(input);
    state.calls.push({ method: (init.method || "GET").toUpperCase(), path, headers: { ...(init.headers || {}) } });
    const forced = state.intercept?.(path, init);
    if (forced) return forced;
    const headers = { ...(init.headers || {}), origin: base };
    const cookie = Object.entries(state.jar).map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.cookie = cookie;
    const r = await realFetch(`${base}${path}`, { ...init, headers });
    for (const c of r.headers.getSetCookie()) { const [pair] = c.split(";"); const i = pair.indexOf("="); state.jar[pair.slice(0, i)] = pair.slice(i + 1); }
    return r;
  };
  return {
    state, clock, op,
    advance: (ms) => { clock.t += ms; },
    reset: () => { op.reset(); state.jar = {}; state.calls = []; state.intercept = null; clock.t = Date.now(); },
    stop: async () => { globalThis.fetch = realFetch; health.stop(); await new Promise((r) => server.close(r)); },
  };
}
export const jsonResponse = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

// Holds the answer to the first request whose path matches until release() is called, then lets it through to the real server.
export function hold(fake, match) {
  let release; const gate = new Promise((r) => { release = r; });
  let held = false;
  fake.state.intercept = (path, init) => {
    if (held || !match(path)) return null;
    held = true;
    return gate.then(() => { fake.state.intercept = null; return globalThis.fetch(path, init); });
  };
  return { release, wasHeld: () => held };
}
