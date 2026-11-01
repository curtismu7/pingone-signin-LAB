// Safety rules. Pure functions plus three tiny middlewares. No I/O.
//  1. Loopback bind only unless SIGNIN_BIND is set on purpose.
//  2. Host header must be a loopback name (DNS-rebinding defence).
//  3. A write must be same-origin: a cross-origin Origin, or a cross-site Sec-Fetch-Site, is refused.
//  4. Every host that appears in any shipped text is reserved (.invalid / .example / apex of example.com|net|org).
//  5. Ports are 6100-6199 only.

export function isLoopbackHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h) && h.split('.').every((o) => Number(o) <= 255);
}

export function bindHost(env = process.env) { return env.SIGNIN_BIND || '127.0.0.1'; }

export function assertBindAllowed(host, env = process.env) {
  if (isLoopbackHost(host) || env.SIGNIN_BIND) return host;
  throw new Error(`refusing to bind ${host}: loopback only. Set SIGNIN_BIND to opt in.`);
}

export function portProblem(port) {
  if (!Number.isInteger(port)) return 'PORT is not an integer';
  if (port < 6100 || port > 6199) return `port ${port} is outside 6100-6199`;
  return null;
}
export function resolvePort(env = process.env) {
  const port = env.PORT === undefined || env.PORT === '' ? 6171 : Number(env.PORT);
  const problem = portProblem(port);
  if (problem) throw new Error(problem);
  return port;
}

export function isReservedHost(host) {
  const h = String(host).toLowerCase().replace(/\.$/, '');
  return /(^|\.)(invalid|example)$/.test(h) || /^example\.(com|net|org)$/.test(h);
}

const NETWORK_URL = /\b(?:https?|wss?|ftp|sftp|ssh|smtp|tcp|udp):\/\/([^\s/?#"'<>\\]+)/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
const stripAuthority = (a) => a.replace(/^[^@]*@/, '').replace(/:\d+$/, '');

// Every hostname or IP found in text that is not reserved. Loopback names in URLs are allowed. Empty = clean.
export function scanHosts(text) {
  const found = new Set();
  const s = String(text);
  for (const m of s.matchAll(NETWORK_URL)) found.add(stripAuthority(m[1]).toLowerCase());
  for (const m of s.matchAll(EMAIL)) found.add(m[1].toLowerCase());
  for (const m of s.matchAll(IPV4)) found.add(m[0]);
  return [...found].filter((h) => !isReservedHost(h) && !isLoopbackHost(h)).sort();
}

// Parses a Host header strictly: host[:port] or [v6][:port]. Returns the lower-case hostname, or null if malformed.
export function parseHostHeader(raw) {
  const m = /^(\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(?::(\d{1,5}))?$/.exec(String(raw || ''));
  if (!m) return null;
  if (m[2] !== undefined && (Number(m[2]) < 1 || Number(m[2]) > 65535)) return null;
  return m[1].toLowerCase();
}

export function makeHostCheck() {
  return function hostCheck(req, res, next) {
    const host = parseHostHeader(req.headers.host);
    // Node keeps the first of several Host headers and drops the rest; RFC 9112 says to refuse such a request.
    const hostCount = Array.isArray(req.rawHeaders) ? req.rawHeaders.filter((x, i) => i % 2 === 0 && x.toLowerCase() === 'host').length : 1;
    if (host === null || hostCount > 1 || !isLoopbackHost(host)) {
      return res.status(403).json({ error: 'bad_host', message: 'Host must be a loopback name' });
    }
    next();
  };
}
export const hostCheck = makeHostCheck();

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DEFAULT_PORT = { 'http:': '80', 'https:': '443' };
export function makeSameOriginWrites() {
  return function sameOriginWrites(req, res, next) {
    if (!WRITE.has(req.method)) return next();
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return res.status(403).json({ error: 'cross_origin', message: 'writes must be same-origin' });
    const origin = req.headers.origin;
    if (origin) {
      let ok = false;
      try {
        const o = new URL(origin);
        const hostHeader = String(req.headers.host || '').toLowerCase();
        // The Origin's host (default port dropped by URL) must be the Host this request arrived with; "host:443" on https is the same origin as "host".
        const dp = DEFAULT_PORT[o.protocol];
        ok = (o.protocol === 'http:' || o.protocol === 'https:') && (o.host === hostHeader || (dp && o.host === hostHeader.replace(new RegExp(`:${dp}$`), '')));
      } catch { /* malformed */ }
      if (!ok) return res.status(403).json({ error: 'cross_origin', message: 'writes must be same-origin' });
    }
    next();
  };
}
export const sameOriginWrites = makeSameOriginWrites();

// Echoed text is shown inert: control and bidi characters become visible escapes so a typed value can not move the cursor,
// forge a log line or flip text direction.
export function inert(value, max = 120) {
  return String(value).slice(0, max).replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
