// End-to-end tests: a real chromium against the real server (netguard on, web/dist served) on a port in 6100-6199.
// Run with `npm run e2e` (builds web first). Screenshots go to E2E_SHOTS (default test-results/shots, git-ignored).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { defineConfig } from '@playwright/test';

// Port: E2E_PORT if set, else the first free port in 6173-6199 (never a fixed one: another checkout or session may already
// hold 6172, and two runs sharing one server reset each other's state). The choice is stored in the environment so the
// worker processes, which load this file again, use the same port.
function freePort() {
  const probe = `const net=require('net');(async()=>{for(let p=6173;p<=6199;p++){const ok=await new Promise(r=>{const s=net.createServer();s.once('error',()=>r(false));s.listen(p,'127.0.0.1',()=>s.close(()=>r(true)));});if(ok){console.log(p);return;}}process.exit(1);})();`;
  return execFileSync(process.execPath, ['-e', probe], { encoding: 'utf8' }).trim();
}
process.env.E2E_PORT = process.env.E2E_PORT || freePort();
const PORT = Number(process.env.E2E_PORT);
if (PORT < 6100 || PORT > 6199) throw new Error('E2E_PORT must be in 6100-6199');
const ROOT = path.resolve(import.meta.dirname, '..');

// A temp directory stands in for config: the server reads PORT and WEB_DIST from the environment (and settings only from STANDALONE_ENV).
// (Created once and shared through the environment: the workers load this file again.)
process.env.E2E_TMP = process.env.E2E_TMP || fs.mkdtempSync(path.join(os.tmpdir(), 'signin-lab-e2e-'));
const tmp = process.env.E2E_TMP;
console.log(`e2e: port ${process.env.E2E_PORT}, server log ${path.join(tmp, 'server.log')}`);

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: '*.spec.js',
  workers: 1, // the server holds the lab state; the tests share one server and reset it before each test
  fullyParallel: false,
  timeout: 90_000, // the machine is shared; a loaded run was seen taking 2.6 minutes for 18 tests
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: path.join(tmp, 'results'),
  use: { baseURL: `http://127.0.0.1:${PORT}`, browserName: 'chromium', headless: true, locale: 'en-US', timezoneId: 'UTC' },
  webServer: {
    command: 'node e2e/start-server.mjs',
    cwd: ROOT,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { E2E_SERVER_LOG: path.join(tmp, 'server.log'), PORT: String(PORT), WEB_DIST: path.join(ROOT, 'web/dist'), NODE_ENV: 'test', STANDALONE_ENV: path.join(tmp, 'no-settings.env') }, // an empty settings path: the run never reads the real shared file
  },
});
