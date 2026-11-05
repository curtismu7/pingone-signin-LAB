// One Express app. /api = demo API (catalog, scenarios, run, reset, safety-scan, health); /mock = the live mock PingOne
// (authorize, flows, resume, token, bc-authorize, phone, rs) for curl and Postman. Loopback Host check and same-origin writes everywhere.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createMockOP, parseTraceparent, USERS, CLIENTS, ACR, DEFAULTS, MOCK_PASSWORD, MOCK_OTP } from 'pingone-piflow-core';
import { makeHostCheck, makeSameOriginWrites, scanHosts, inert } from './safety.js';
import { createHealth } from './health.js';
import { SCENARIOS, VERTICALS, getScenario, getVertical, renderScenario, castNames, storyCorpus, vocabFor } from './stories.js';
import { createTraceSink, resolveWorkspace, validWorkspaceId, workspaceDir } from './workspace.js';
import { loadCustomerConfig } from './customerConfig.js';
import { runScenario, runAll } from './runner.js';
import { createDiagramsRouter } from './diagrams.js';
import { shelfInfo } from './shelfLink.js';

const DEFAULT_WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
// Same shortening the trace uses (ASCII dots: a header value must be latin1), so the UI can show the rotating session-token cookie (it is HttpOnly, the page can not read it).
export const previewCookie = (c) => String(c).split(';')[0].replace(/^([^=]*)=(.*)$/, (_m, k, v) => `${k}=${v.length > 6 ? v.slice(0, 6) : '***'}...`);
const validTp = (v) => (parseTraceparent(v) ? v : null);
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

const bad = (res, msg, status = 400) => res.status(status).json({ error: 'bad_request', message: msg });

export function createApp({
  health = createHealth(), op: initialOp = createMockOP(), webDist = process.env.WEB_DIST || DEFAULT_WEB_DIST,
  workspace = resolveWorkspace(), dataRoot = process.env.SIGNIN_DATA_DIR || null, customerFile = undefined,
  serveWeb = true,
} = {}) {
  if (!validWorkspaceId(workspace)) throw new Error('bad workspace id'); // even when there is no data directory
  const op = initialOp; // POST /api/reset empties it (and mints a new key)
  // This app instance IS one workspace: its own mock (above), its own trace sink and data directory. Two instances share nothing.
  const sink = createTraceSink({ workspace, dir: dataRoot ? workspaceDir(dataRoot, workspace) : null });
  const verticalIds = VERTICALS.map((v) => v.id);
  const customer = () => loadCustomerConfig({ file: customerFile, verticals: verticalIds }).config;
  const defaultVertical = () => customer().vertical || VERTICALS[0].id;
  const sinkScenario = (r) => (r.trace || []).forEach((e) => sink.record({ source: 'scenario', scenario: r.id, vertical: r.vertical, n: e.n, method: e.request.method, path: String(e.request.url).replace(/^https?:\/\/[^/]+/, '').split('?')[0], status: e.response.status, traceparent: e.request.headers?.traceparent ?? null, replyTraceparent: e.response.headers?.traceparent ?? null }));
  const diagramsRouter = createDiagramsRouter();
  const app = express();
  app.disable('x-powered-by');
  app.use(makeHostCheck());
  app.use(makeSameOriginWrites());
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Cache-Control', 'no-store'); next(); });

  const api = express.Router();
  api.use(express.json({ limit: '8kb' }));
  api.use('/health', health.router);
  api.use('/diagrams', diagramsRouter);
  api.get('/catalog', (req, res) => {
    const v = getVertical(req.query.vertical || defaultVertical());
    if (!v) return bad(res, `unknown vertical ${inert(req.query.vertical)}`);
    const cust = customer();
    res.json({
      mock: true, mode: 'mock', workspace, issuer: DEFAULTS.issuer, vertical: v.id, customer: cust, vocab: vocabFor(v, cust),
      verticals: VERTICALS.map(({ id, name, cast }) => ({ id, name, cast })),
      cast: Object.entries(v.cast).map(([role, user]) => ({ role, username: user, name: USERS[user].name, mfa: USERS[user].mfa, devices: USERS[user].devices.length })),
      mockCredentials: { password: MOCK_PASSWORD, otp: MOCK_OTP, note: 'throwaway values for this process only' },
      acr: { values: Object.values(ACR), note: 'mock names; the acr strings a real PingOne issues are UNVERIFIED' },
      clients: Object.entries(CLIENTS).map(([id, c]) => ({ id, name: c.name, redirectUri: c.redirectUris[0] })),
      limits: { flowTtlSeconds: DEFAULTS.flowTtlS, maxPasswordAttempts: DEFAULTS.maxAttempts, bindingMessageMax: DEFAULTS.bindingMax },
      scenarios: SCENARIOS.map((s) => { const r = renderScenario(s, v, cust); return { id: r.id, slug: r.slug, kind: r.kind, title: r.title, takeaway: r.takeaway, expected: r.expect }; }),
    });
  });
  api.get('/scenarios', (req, res) => {
    const v = getVertical(req.query.vertical || defaultVertical());
    if (!v) return bad(res, `unknown vertical ${inert(req.query.vertical)}`);
    res.json({ vertical: v.id, cast: castNames(v), scenarios: SCENARIOS.map((s) => { const r = renderScenario(s, v, customer()); return { id: r.id, slug: r.slug, kind: r.kind, title: r.title, takeaway: r.takeaway }; }) });
  });
  api.post('/run', async (req, res, next) => {
    try {
      const { scenario, vertical = defaultVertical() } = req.body || {};
      if (typeof scenario !== 'string' || !getScenario(scenario)) return bad(res, 'scenario must be a known id or slug');
      if (typeof vertical !== 'string' || !getVertical(vertical)) return bad(res, 'unknown vertical');
      const result = await runScenario(scenario, vertical, customer());
      sinkScenario(result);
      res.json(result);
    } catch (e) { next(e); }
  });
  api.post('/run-all', async (req, res, next) => {
    try {
      const { vertical = defaultVertical() } = req.body || {};
      if (typeof vertical !== 'string' || !getVertical(vertical)) return bad(res, 'unknown vertical');
      const results = await runAll(vertical, customer());
      results.forEach(sinkScenario);
      res.json({ vertical, total: results.length, passed: results.filter((r) => r.pass).length, results });
    } catch (e) { next(e); }
  });
  api.post('/reset', (_req, res) => { op.reset(); sink.clear(); res.json({ reset: 'ok' }); });
  api.get('/workspace', (_req, res) => res.json({ workspace }));
  api.get('/trace', (_req, res) => res.json({ workspace, entries: sink.list() }));
  api.get('/customer-config', (_req, res) => { const r = loadCustomerConfig({ file: customerFile, verticals: verticalIds }); res.json({ present: r.present, valid: r.errors.length === 0, errors: r.errors, config: r.config }); });
  api.get('/safety-scan', (_req, res) => {
    const findings = storyCorpus().map(({ where, text }) => ({ where, hosts: scanHosts(text) })).filter((x) => x.hosts.length);
    res.json({ clean: findings.length === 0, scanned: storyCorpus().length, findings });
  });
  api.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.get('/api/shelf', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(shelfInfo()); }); // the header "Shelf" button
  app.use('/api', api);

  const mock = express.Router();
  mock.use(express.json({ limit: '8kb', type: ['application/json', 'application/*+json'] }));
  mock.use(express.urlencoded({ extended: false, limit: '8kb' }));
  mock.use((req, res) => {
    const out = op.handle({
      method: req.method, path: req.path, query: req.query, headers: req.headers, body: req.body,
      baseUrl: `http://${req.headers.host}/mock`,
    });
    sink.record({ source: 'mock', method: req.method, path: req.path, status: out.status, traceparent: validTp(req.headers.traceparent), replyTraceparent: validTp(out.headers?.traceparent) });
    for (const [k, v] of Object.entries(out.headers || {})) {
      if (k === 'set-cookie') { for (const c of v) res.append('Set-Cookie', c); res.set('X-Mock-Cookie-Preview', v.map(previewCookie).join(', ')); } else res.set(k, v);
    }
    res.status(out.status).json(out.body);
  });
  app.use('/mock', mock);

  if (serveWeb) mountWeb(app, webDist);

  // JSON parse failures and anything unexpected: a clean JSON error, never a stack trace.
  app.use((err, _req, res, _next) => { // eslint-disable-line no-unused-vars
    const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
    res.status(status).json({ error: status === 500 ? 'server_error' : 'bad_request', message: status === 500 ? 'unexpected error' : 'request could not be read' });
  });
  return app;
}

// The built web UI (npm run build). Absent in a bare checkout: the API and the mock still work.
export function mountWeb(app, webDist) {
  if (!fs.existsSync(path.join(webDist, 'index.html'))) return;
  const page = (res) => { res.set('Content-Security-Policy', CSP); res.set('Cache-Control', 'no-store'); };
  app.use(express.static(webDist, { index: false, setHeaders: (res, file) => { if (file.endsWith('.html')) page(res); } }));
  // Only extension-less paths are UI routes; a missing /assets/x.js is a 404, not an HTML page that a script tag would choke on.
  app.get(/^\/(?!api\/|mock\/).*/, (req, res) => {
    if (path.extname(req.path)) return res.status(404).json({ error: 'not_found' });
    page(res); res.sendFile(path.join(webDist, 'index.html'));
  });
}

export function startHttpServer({ port, host, app = createApp() } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}/` }));
    server.once('error', reject);
  });
}
