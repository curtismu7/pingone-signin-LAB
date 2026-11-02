// Repo-level checks: hygiene, docs truth, the pi.flow-only rule, reserved hosts, the pre-commit hook.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { portProblem, scanHosts } from '../server/src/safety.js';
import { reset } from './reset.mjs';
import { validatePack } from './validate-content-pack.mjs';
import { buildPack } from './build-content-pack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function trackedTextFiles() {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  return out.filter((f) => !/package-lock\.json$|node_modules/.test(f) && fs.existsSync(path.join(ROOT, f)));
}

test('every shipped text file mentions only reserved hosts', () => {
  const offenders = [];
  for (const f of trackedTextFiles()) {
    if (/^(server|core)\/test\//.test(f) || f === 'scripts/repo.test.mjs') continue; // tests name real-looking hosts on purpose, as negative cases
    const hosts = scanHosts(read(f)).filter((h) => /^[a-z0-9.-]+$/.test(h) && h !== '0.0.0.0' && !/^(www\.)?(rfc-editor\.org|datatracker\.ietf\.org|json-schema\.org|openid\.net)$/.test(h) && !(h === 'github.com' && ['.github/workflows/ci.yml', 'README.md'].includes(f))); // CI downloads gitleaks from its release page; the README names the repo URL
    if (hosts.length) offenders.push(`${f}: ${hosts.join(', ')}`);
  }
  assert.deepEqual(offenders, []);
});

test('no forbidden string appears in any tracked file (list is read, never printed)', (t) => {
  const file = path.join(os.homedir(), '.config/demo-kit/forbidden-strings.txt');
  if (!fs.existsSync(file)) return t.skip('forbidden-strings.txt not present on this machine');
  const needles = fs.readFileSync(file, 'utf8').split('\n').map((x) => x.trim()).filter(Boolean);
  let hits = 0;
  for (const f of trackedTextFiles()) { const text = read(f); for (const n of needles) if (text.includes(n)) hits++; }
  assert.equal(hits, 0, `${hits} forbidden-string hit(s) (values deliberately not shown)`);
});

test('the server source makes no outbound HTTP calls of its own', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'server/src'), { recursive: true })) {
    if (f === 'netguard.js' || !f.endsWith('.js')) continue; // (recursive: the vendored validator is scanned too)
    assert.doesNotMatch(read(`server/src/${f}`), /\bfetch\(|https?\.request|https?\.get|axios|node-fetch|net\.connect|new WebSocket/, f);
  }
});

test('workspaces are core, server, web; core is named pingone-piflow-core and has no dependencies', () => {
  const root = JSON.parse(read('package.json'));
  assert.deepEqual(root.workspaces, ['core', 'server', 'web']);
  const core = JSON.parse(read('core/package.json'));
  assert.equal(core.name, 'pingone-piflow-core');
  assert.equal(core.dependencies, undefined);
  const web = JSON.parse(read('web/package.json'));
  assert.equal(web.scripts.build, 'vite build');
  assert.equal(web.scripts.test, 'vitest run');
  assert.equal(JSON.parse(read('package.json')).scripts.build, 'npm run build -w web');
});

test('core stays pure: no express, no sockets, no http client, no key-pair generation', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'core/src'))) {
    const s = read(`core/src/${f}`);
    assert.doesNotMatch(s, /from 'express'|from 'node:(http|https|net|dgram|dns|tls)'|require\(/, f);
    assert.doesNotMatch(s, /generateKeyPair/, f);
  }
});

test('nothing in the repo generates key pairs (HS256 with a throwaway key only; no EC generateKeyPair, sync or async)', () => {
  for (const f of trackedTextFiles().filter((x) => /\.(js|mjs|jsx)$/.test(x) && !/repo\.test\.mjs$/.test(x))) assert.doesNotMatch(read(f), /generateKeyPair/, f);
});

test('login is pi.flow only: no redirect responses and no Location header anywhere in the source', () => {
  for (const f of trackedTextFiles().filter((x) => /^(core|server)\/src\/.*\.js$/.test(x))) {
    const s = read(f);
    assert.doesNotMatch(s, /\.redirect\(|[\s'"]location['"]?\s*:|setHeader\(\s*['"]location/i, f);
  }
});

test('test scripts always use a glob, never a directory', () => {
  for (const p of ['core/package.json', 'server/package.json']) assert.match(JSON.parse(read(p)).scripts.test, /^node --test test\/\*\.test\.js$/, p);
  assert.match(JSON.parse(read('package.json')).scripts.test, /node --test scripts\/\*\.test\.mjs/);
});

test('the pre-commit hook runs gitleaks and is executable', () => {
  const hook = read('.githooks/pre-commit');
  assert.match(hook, /gitleaks protect --staged/);
  assert.ok(fs.statSync(path.join(ROOT, '.githooks/pre-commit')).mode & 0o111);
});

test('license is MIT, .env is ignored, a changelog and the docs exist', () => {
  assert.match(read('LICENSE'), /^MIT License/);
  assert.match(read('.gitignore'), /^\.env$/m);
  assert.match(read('CHANGELOG.md'), /^# Changelog/);
  for (const d of ['architecture', 'safety', 'talk-track']) assert.ok(fs.existsSync(path.join(ROOT, `docs/${d}.md`)), d);
});

test('docs name only ports in 6100-6199 and the README states the default port', () => {
  const ports = new Set();
  for (const f of ['README.md', 'docs/architecture.md', 'docs/safety.md', 'docs/talk-track.md', '.env.example']) {
    for (const m of read(f).matchAll(/(?:localhost|127\.0\.0\.1|PORT=|HOST_PORT=)[:=]?(\d{4,5})/g)) ports.add(Number(m[1]));
  }
  assert.ok(ports.has(6171));
  const SIBLING_LAB_PORT = 5500; // pingone-LAB, named only as a pointer to the lab that holds the real PingOne shapes
  for (const p of ports) if (p !== SIBLING_LAB_PORT) assert.equal(portProblem(p), null, String(p));
});

test('the README only promises npm scripts and curl endpoints that exist', () => {
  const readme = read('README.md');
  const scripts = JSON.parse(read('package.json')).scripts;
  for (const m of readme.matchAll(/npm run ([\w-]+)/g)) assert.ok(scripts[m[1]], `npm run ${m[1]}`);
  for (const m of readme.matchAll(/\/api\/([a-z-]+)/g)) assert.ok(['health', 'catalog', 'scenarios', 'run', 'run-all', 'reset', 'safety-scan', 'workspace', 'trace', 'customer-config', 'diagrams'].includes(m[1]), `/api/${m[1]}`);
});

test('reset.mjs refuses a non-loopback host before any request', async () => {
  await assert.rejects(reset('http://reset-target.invalid:6171'), /loopback only/);
});

test('login is pi.flow only in the web UI too: no navigation to an authorize URL, no other response_mode', () => {
  const files = trackedTextFiles().filter((x) => /^web\/src\/.*\.(js|jsx)$/.test(x) && !/\/test\//.test(x));
  assert.ok(files.length > 10);
  for (const f of files) {
    const s = read(f);
    assert.doesNotMatch(s, /location\.(assign|replace)\(|location\.href\s*=|window\.open\(|<form[^>]*action=/, f);
    for (const m of s.matchAll(/response_mode[^\n]{0,40}/g)) assert.match(m[0], /pi\.flow/, `${f}: ${m[0]}`);
    assert.doesNotMatch(s, /dangerouslySetInnerHTML|innerHTML\s*=/, f);
  }
});

test('npm test runs core, server and web unit tests; e2e is its own script and the README documents it', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  for (const w of ['core', 'server', 'web']) assert.match(scripts.test, new RegExp(`npm test -w ${w}`));
  assert.match(scripts.test, /node --test scripts\/\*\.test\.mjs/);
  assert.doesNotMatch(scripts.test, /playwright/);
  assert.match(scripts.e2e, /playwright test -c e2e\/playwright\.config\.js/);
  assert.match(read('README.md'), /npm run e2e/);
  assert.match(read('e2e/playwright.config.js'), /first free port in 6173-6199/);
  assert.match(read('e2e/playwright.config.js'), /6100/);
});

test('the Dockerfile builds the web UI in its own stage, ships web/dist, and stays loopback-published via compose', () => {
  const d = read('Dockerfile');
  assert.match(d, /FROM node:26-alpine AS build/);
  assert.equal((d.match(/^FROM node:26-alpine/gm) || []).length, 2, 'Node 26 in both stages');
  assert.doesNotMatch(d, /node:(18|20|22|24)/);
  assert.match(d, /npm run build -w web/);
  assert.match(d, /COPY --from=build \/app\/web\/dist web\/dist/);
  assert.match(d, /SIGNIN_BIND=0\.0\.0\.0/);
  assert.match(read('README.md'), /docker compose up --build -d/);
  assert.doesNotMatch(d, /untested/i);
});

test('content pack validates and is in sync with the scenario data and the UI tabs', () => {
  const pack = JSON.parse(read('content-pack.json'));
  assert.deepEqual(validatePack(pack), []);
  assert.deepEqual(pack, buildPack(), 'run: node scripts/build-content-pack.mjs');
  assert.deepEqual(pack.stories.map((s) => s.id), JSON.parse(read('server/data/scenarios.json')).map((s) => s.id));
  for (const st of pack.stories) assert.doesNotMatch(`${st.title} ${st.say}`, /\{\{/, `${st.id} has an unrendered token`);
  assert.equal(pack.demo.doctor, '/api/health');
  assert.equal(pack.demo.catalog, 'A11');
  assert.ok(pack.demo.tags.includes('catalog-A4') && pack.demo.tags.includes('catalog-A5'));
  for (const c of pack.cards.filter((x) => x.group !== 'setup')) assert.match(c.action.href, /^\/#\/(signin|stepup|ciba|scenarios|diagram|talk)$/, c.id);
  const terms = pack.glossary.map((g) => g.id);
  for (const t of ['pi-flow', 'redirect-login', 'flow-status', 'session-token-cookie', 'step-up', 'ciba', 'traceparent']) assert.ok(terms.includes(t), t);
  const text = JSON.stringify(pack);
  for (const must of ['mock:single', 'UNVERIFIED', '8 characters']) assert.ok(text.includes(must), must);
});

test('content pack validation rejects a broken pack', () => {
  const pack = buildPack();
  pack.cards[0].terms = ['no-such-term'];
  assert.ok(validatePack(pack).some((e) => /unknown glossary id/.test(e)));
  delete pack.glossary;
  assert.ok(validatePack(pack).length > 0);
});

test('shelf entry is one flat object in the committed shelf format, with a description of at most 300 characters', () => {
  const d = JSON.parse(read('docs/shelf-entry.json'));
  assert.ok(!Array.isArray(d) && !('demos' in d), 'flat object, not wrapped in a demos array');
  for (const k of ['id', 'name', 'kind', 'description', 'url', 'healthPath', 'composeFile', 'composeOverlays', 'port', 'notes', 'catalogId']) assert.ok(k in d, k);
  assert.ok(typeof d.description === 'string' && d.description.length > 0 && d.description.length <= 300, `description is ${d.description.length} characters`);
  assert.match(d.description, /pingone-LAB/, 'the description points at the sibling lab');
  assert.equal(d.port, Number(new URL(d.url).port));
});

test('shelf entry matches the demo: id, port, health path, loopback url', () => {
  const d = JSON.parse(read('docs/shelf-entry.json'));
  assert.equal(d.id, 'pingone-signin-lab');
  assert.equal(d.healthPath, '/api/health');
  assert.equal(d.catalogId, 'A11');
  assert.equal(JSON.parse(read('content-pack.json')).demo.catalog, d.catalogId);
  const u = new URL(d.url);
  assert.equal(u.hostname, 'localhost');
  assert.equal(portProblem(Number(u.port)), null);
  assert.equal(JSON.parse(read('content-pack.json')).demo.baseUrl, d.url);
});

test('diagrams are ReactFlow only (no mermaid); the app CSS is on the shared tokens: no colour literal, no purple, no dark-mode query, no forced priority, no italics', () => {
  const all = trackedTextFiles().filter((f) => /^web\/(src|package\.json)/.test(f) || f === 'package.json');
  for (const f of all) assert.doesNotMatch(read(f), /mermaid/i, f);
  assert.ok(JSON.parse(read('web/package.json')).dependencies['@xyflow/react']);
  const css = read('web/src/app.css');
  assert.doesNotMatch(css, /purple|violet|indigo|lavender|magenta/i);
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rules, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/, 'colours come from var(--token)');
  assert.doesNotMatch(rules, /prefers-color-scheme|!important|font-style:\s*italic/);
  for (const m of rules.matchAll(/@media[^{]*max-width:\s*(\d+)px/g)) assert.ok(['600', '900'].includes(m[1]), `breakpoint ${m[1]}px`);
  assert.doesNotMatch(rules, /@media[^{]*\b(min|max)-width:\s*\d+(rem|em)/);
});

test('the shared stylesheet is loaded before the app stylesheet', () => {
  const main = read('web/src/main.jsx');
  assert.ok(main.indexOf('./styles/standalone-ui.css') > -1 && main.indexOf('./styles/standalone-ui.css') < main.indexOf('./app.css'));
  assert.match(read('web/src/styles/standalone-ui.css'), /^\/\*\n  standalone-ui\.css: the shared UI standard/);
});

test('the hub validator checks are enforced here: dotted ids, token-shaped strings, bad links, bad dates, duplicates, unknown schema', () => {
  const bad = (edit) => { const p = buildPack(); edit(p); return validatePack(p); };
  assert.deepEqual(validatePack(buildPack()), []);
  assert.ok(bad((p) => { p.glossary[0].id = 'a.b'; }).some((e) => /glossary\/0\/id must match/.test(e)));
  assert.ok(bad((p) => { p.glossary[1].id = p.glossary[0].id; }).some((e) => /duplicate id/.test(e)));
  assert.ok(bad((p) => { p.glossary[0].definition = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig'; }).some((e) => /raw token/.test(e)));
  assert.ok(bad((p) => { p.glossary[0].definition = 'bad\u0001char'; }).some((e) => /control characters/.test(e)));
  assert.ok(bad((p) => { p.cards[0].action.href = '//evil.example/x'; }).some((e) => /single "\/"/.test(e)));
  assert.ok(bad((p) => { p.cards[0].action = { type: 'external', href: 'javascript:alert(1)' }; }).some((e) => /http\(s\)/.test(e)));
  assert.ok(bad((p) => { p.sources[0].url = 'ftp://x.example/'; }).some((e) => /http\(s\)/.test(e)));
  assert.ok(bad((p) => { p.sources[0].checked = 'yesterday'; }).length > 0, 'formats are checked');
  assert.ok(bad((p) => { p.diagrams[0].href = 'nope'; }).length > 0);
  assert.ok(bad((p) => { p.demo.baseUrl = 'http://user:pw@localhost:6171'; }).some((e) => /baseUrl/.test(e)));
  assert.ok(bad((p) => { p.demo.doctor = 'api/health'; }).length > 0);
  assert.ok(bad((p) => { p.schema = 'demo-content-pack/2'; }).some((e) => /unsupported pack schema/.test(e)));
  assert.ok(bad((p) => { p.extra = 1; }).length > 0);
  assert.ok(bad((p) => { p.glossary[0].definition = 'x'.repeat(8001); }).some((e) => /longer than/.test(e)));
});

test('shelf entry: catalog id A11 matches the pack, composeFile is a relative path that exists in this repo (portable: no author path)', () => {
  const d = JSON.parse(read('docs/shelf-entry.json'));
  assert.equal(d.catalogId, 'A11');
  assert.equal(JSON.parse(read('content-pack.json')).demo.catalog, 'A11');
  assert.ok(!path.isAbsolute(d.composeFile), d.composeFile);
  assert.ok(!/^[A-Za-z]:|^~|\\\\|\.\.\//.test(d.composeFile), d.composeFile);
  assert.ok(fs.existsSync(path.resolve(ROOT, d.composeFile)), 'composeFile resolves inside the repo');
  assert.doesNotMatch(read('docs/shelf-entry.json'), /\/Users\/|\/home\//);
  for (const f of trackedTextFiles()) if (!/^(scripts\/repo\.test\.mjs|web\/src\/test\/|server\/test\/)/.test(f) && /\.(json|md|yml|mjs|js|jsx)$/.test(f)) assert.ok(!read(f).includes(`/Users/${os.userInfo().username}`), `${f} names the author's home directory`);
});

test('ci.yml shape: GitHub-hosted runners, Node 26 only, checkout and setup-node v5, build/test/e2e/doctor/forbidden-strings/gitleaks jobs', () => {
  const ci = read('.github/workflows/ci.yml');
  for (const job of ['build', 'test', 'e2e', 'doctor', 'forbidden-strings', 'gitleaks']) assert.match(ci, new RegExp(`^  ${job}:`, 'm'), job);
  assert.doesNotMatch(ci, /self-hosted|macOS|RUNS_ON/);
  assert.ok((ci.match(/runs-on: ubuntu-latest/g) || []).length >= 6);
  const versions = [...ci.matchAll(/node-version:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(versions.length >= 4 && versions.every((v) => v === '26'), versions.join(','));
  assert.doesNotMatch(ci, /matrix/);
  assert.doesNotMatch(ci, /actions\/(checkout|setup-node)@v[1-4]\b/);
  assert.ok((ci.match(/actions\/checkout@v5/g) || []).length >= 6);
  assert.match(ci, /npx playwright install --with-deps chromium/);
  assert.match(ci, /run: npm run e2e/);
  assert.match(ci, /gitleaks detect --source \./);
  assert.match(ci, /git log -p --all \| grep -cF -f "\$list"/);
  assert.match(ci, /test -s "\$list"/, 'an empty FORBIDDEN_STRINGS secret fails the job');
  assert.match(ci, /secrets\.FORBIDDEN_STRINGS/);
  assert.match(ci, /fetch-depth: 0/);
});

test('Node 26 everywhere: engines, .nvmrc, Dockerfile', () => {
  assert.equal(JSON.parse(read('package.json')).engines.node, '>=26');
  assert.equal(read('.nvmrc').trim(), '26');
});

test('Docker only: no k8s, SE, hosted or MODE code, files or settings are left', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'k8s')));
  for (const f of ['scripts/deploy-se.sh', 'docs/se-deploy.md', 'docs/shelf-entry.se.json', 'server/src/hosted.js']) assert.ok(!fs.existsSync(path.join(ROOT, f)), f);
  for (const f of trackedTextFiles().filter((x) => /\.(js|mjs|jsx|json|ya?ml|sh)$/.test(x) && !/^(scripts\/.*\.test\.mjs|web\/src\/test\/|server\/test\/|package-lock\.json)/.test(x))) {
    const t = read(f);
    assert.doesNotMatch(t, /process\.env\.MODE|\benv\.MODE\b|SIGNIN_HOSTED|SIGNIN_ALLOWED_HOSTS|__SE_HOST__|__IMAGE__|__NAMESPACE__/, f);
  }
});

test('README follows the standard: title ends in LAB, Tier/Repo/Catalog lines, the sections in order, the exact port-taken text', () => {
  const r = read('README.md');
  assert.match(r.split('\n')[0], /^# .+ LAB$/);
  assert.match(r, /^Tier: Demo$/m);
  assert.match(r, /^Repo: https:\/\/github\.com\/ping-sandbox\/pingone-signin-LAB$/m);
  assert.match(r, /^Catalog: A11$/m);
  const heads = [...r.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  const want = ['What is simulated', 'Run from a clone', 'Settings file', 'Ports, and what to do if the port is taken', 'Mock and live modes', 'Health, doctor and reset', 'Docker (optional)', 'Tests', 'Troubleshooting', 'Ownership'];
  assert.deepEqual(heads, want);
  assert.match(r, /If the port is taken:\n1\. Find what is using it:\n/);
  assert.match(r, /Do not use 8080, 5173, 3000, 4000, 4400, 4510, 4600-4601, 18080, 19080 or 19090\./);
  assert.doesNotMatch(r, /MODE=|SIGNIN_HOSTED|k8s|Node 20|Node 22/);
});

test('conformance files: CLAUDE.md states the rules that bite, customer.config example is valid, no real customer.config.json is tracked', () => {
  const c = read('CLAUDE.md');
  for (const must of ['pi.flow only', 'mock', 'node --test test/*.test.js', 'generateKeyPairSync', '6100-6199', 'npm run e2e', 'SIGNIN_WORKSPACE', 'traceparent', 'forbidden-strings']) assert.ok(c.includes(must), must);
  assert.ok(c.split('\n').length < 40, 'short');
  assert.match(read('.gitignore'), /^customer\.config\.json$/m);
  assert.ok(!trackedTextFiles().includes('customer.config.json'));
  assert.match(read('README.md'), /Tier: Demo/);
});




test('the content pack names the diagram data files, one entry per file', () => {
  const ids = fs.readdirSync(path.join(ROOT, 'server/data/diagrams')).map((f) => f.replace(/\.json$/, '')).sort();
  assert.deepEqual(JSON.parse(read('content-pack.json')).diagrams.map((d) => d.id).sort(), ids);
});
