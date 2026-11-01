// Preflight checks shared by `npm run doctor` and GET /api/health. Never prints a secret, needs no network.
// Each check: { id, level: 'pass' | 'info' | 'fail', detail }.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockOP, createInProcessFetch } from 'pingone-piflow-core';
import { assertBindAllowed, bindHost, portProblem, scanHosts } from './safety.js';
import { netguardSelfTest } from './netguard.js';
import { SCENARIOS, storyCorpus, undefinedTokens, VERTICALS } from './stories.js';
import { loadCustomerConfig } from './customerConfig.js';
import { validWorkspaceId, DEFAULT_WORKSPACE } from './workspace.js';
import { runAll } from './runner.js';

const DEFAULT_WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');

export async function runChecks({ env = process.env, makeOp = createMockOP, webDist = env.WEB_DIST || DEFAULT_WEB_DIST, customerFile = env.SIGNIN_CUSTOMER_CONFIG || undefined } = {}) {
  const checks = [];
  const add = (id, level, detail) => checks.push({ id, level, detail });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 26 ? 'pass' : 'fail', `v${process.versions.node} (need >= 26)`);

  try { add('bind', 'pass', `${assertBindAllowed(bindHost(env), env)}${env.SIGNIN_BIND ? ' (SIGNIN_BIND opt-in)' : ' (loopback)'}`); }
  catch (e) { add('bind', 'fail', e.message); }

  const port = env.PORT === undefined || env.PORT === '' ? 6171 : Number(env.PORT);
  const problem = portProblem(port);
  add('port-range', problem ? 'fail' : 'pass', problem || `${port} is inside 6100-6199`);

  const ws = env.SIGNIN_WORKSPACE === undefined || env.SIGNIN_WORKSPACE === '' ? DEFAULT_WORKSPACE : env.SIGNIN_WORKSPACE;
  add('workspace', validWorkspaceId(ws) ? 'pass' : 'fail', validWorkspaceId(ws) ? `workspace "${ws}"` : 'SIGNIN_WORKSPACE must match [a-z0-9-]{1,32}');

  const cc = loadCustomerConfig({ file: customerFile, verticals: VERTICALS.map((v) => v.id) });
  add('customer-config', cc.errors.length ? 'fail' : 'pass', cc.errors.length ? `customer.config.json is invalid: ${cc.errors.join('; ')}` : cc.present ? 'customer.config.json is valid' : 'no customer.config.json: fictional defaults');

  const undef = [];
  for (const v of VERTICALS) for (const s of SCENARIOS) for (const t of undefinedTokens(`${s.title} ${s.takeaway}`, v, cc.config)) undef.push(`${s.id}/${v.id}: {{${t}}}`);
  add('story-tokens', undef.length ? 'fail' : 'pass', undef.length ? `undefined tokens: ${undef.slice(0, 6).join(', ')}` : `every {{cast.*}} and {{vocab.*}} token is defined in all ${VERTICALS.length} verticals`);

  const bad = storyCorpus().map(({ where, text }) => ({ where, hosts: scanHosts(text) })).filter((x) => x.hosts.length);
  add('story-hosts', bad.length ? 'fail' : 'pass', bad.length ? `non-reserved hosts: ${bad.map((b) => `${b.where}: ${b.hosts.join(', ')}`).join('; ')}` : 'every host in every story and seed is .invalid, .example or loopback');

  const ng = await netguardSelfTest();
  add('netguard', ng.ok ? 'pass' : 'fail', ng.ok ? `blocked fetch, socket, socket-by-IP, dns lookup, dns resolve, reverse lookup (lookupService, callback and promise), udp send and udp connect to a non-loopback host (${ng.blocked}/9)` : ng.detail);

  try {
    const op = makeOp();
    const f = createInProcessFetch(op, { baseUrl: 'https://mock-op.example' });
    const r = await f('https://mock-op.example/authorize?client_id=lab-app', {});
    const body = await r.json();
    const refused = r.status === 400 && /pi\.flow/.test(body.error_description) && !r.headers.getSetCookie().length;
    add('pi-flow-only', refused ? 'pass' : 'fail', refused ? 'authorize without response_mode=pi.flow is refused and issues no flow' : `authorize without pi.flow answered ${r.status}`);
  } catch (e) { add('pi-flow-only', 'fail', `crashed: ${e.message}`); }

  try {
    const results = (await Promise.all(VERTICALS.map((v) => runAll(v.id)))).flat();
    const failed = results.filter((r) => !r.pass);
    add('scenarios', failed.length ? 'fail' : 'pass', failed.length ? `misbehaving: ${failed.map((r) => `${r.id}/${r.vertical}`).join(', ')}` : `${results.length} scenario runs across ${VERTICALS.length} verticals behave as written`);
  } catch (e) { add('scenarios', 'fail', `crashed: ${e.message}`); }

  // Not a failure: the API and the mock work without the UI. `info` tells you how to get it.
  const built = fs.existsSync(path.join(webDist, 'index.html'));
  add('web-dist', built ? 'pass' : 'info', built ? 'web/dist is built and served at /' : 'web/dist is not built: run `npm run build` to get the UI at / (the API and /mock work without it)');

  return checks;
}

export const allPassed = (checks) => checks.every((c) => c.level !== 'fail');
