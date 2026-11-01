import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { installNetguard } from './netguard.js';
import { startHttpServer, createApp } from './app.js';
import { allPassed, runChecks } from './doctor.js';
import { resolveWorkspace } from './workspace.js';
import { assertBindAllowed, bindHost, resolvePort } from './safety.js';
import { applySharedSettings } from './settings.js';

installNetguard(); // before anything else can open a socket

applySharedSettings(); // the one shared settings file (~/Development/.env or STANDALONE_ENV): this lab's own keys only

const checks = await runChecks();
if (!allPassed(checks)) {
  for (const c of checks.filter((x) => x.level === 'fail')) console.error(`[pingone-signin-lab] refusing to start: ${c.id}: ${c.detail}`);
  process.exit(1);
}
const host = assertBindAllowed(bindHost(), process.env);
const webDist = process.env.WEB_DIST || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
const { url } = await startHttpServer({ port: resolvePort(), host, app: createApp({ webDist }) });
console.log(`[pingone-signin-lab] workspace "${resolveWorkspace()}"`);
console.log(`[pingone-signin-lab] mock PingOne at ${url}mock/ (loopback, no outbound network)`);
console.log(`[pingone-signin-lab] API: ${url}api/health | pi.flow: GET ${url}mock/authorize?response_mode=pi.flow&...`);
