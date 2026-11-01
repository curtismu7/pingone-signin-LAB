// An in-process fetchLike: calls the mock OP directly and hands back a real Response (so set-cookie handling is the
// same code path a BFF uses). No sockets. `baseUrl` is the URL clients use, e.g. http://127.0.0.1:6171/mock.
const MAX_BODY = 8192;

function parseBody(contentType, text) {
  if (!text) return {};
  const ct = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (ct === 'application/x-www-form-urlencoded') return Object.fromEntries(new URLSearchParams(text));
  if (ct === 'application/json' || ct.endsWith('+json')) { try { const v = JSON.parse(text); return v && typeof v === 'object' ? v : {}; } catch { return {}; } }
  return {};
}

export function createInProcessFetch(op, { baseUrl = 'https://mock-op.example' } = {}) {
  const base = new URL(baseUrl);
  const prefix = base.pathname.replace(/\/+$/, '');
  return async function fetchLike(input, init = {}) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin !== base.origin || !(url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) {
      return new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'not the mock origin' }), { status: 404, headers: { 'content-type': 'application/json' } });
    }
    const headers = {};
    for (const [k, v] of Object.entries(init.headers || {})) headers[k.toLowerCase()] = String(v);
    const text = typeof init.body === 'string' ? init.body.slice(0, MAX_BODY) : '';
    const out = op.handle({
      method: init.method || 'GET', path: url.pathname.slice(prefix.length) || '/', query: Object.fromEntries(url.searchParams), headers,
      body: parseBody(headers['content-type'], text), baseUrl,
    });
    const h = new Headers({ 'content-type': 'application/json' });
    for (const [k, v] of Object.entries(out.headers || {})) for (const one of Array.isArray(v) ? v : [v]) h.append(k, one);
    return new Response(JSON.stringify(out.body), { status: out.status, headers: h });
  };
}
