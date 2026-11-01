import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SETTINGS_KEYS, applySharedSettings, readSharedSettings, settingsPath } from '../src/settings.js';

const withFile = (text, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signin-set-'));
  const f = path.join(dir, '.env'); fs.writeFileSync(f, text, { mode: 0o600 });
  try { return fn(f); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test("only this lab's own keys are taken from the shared settings file; every other key stays out", () => {
  assert.deepEqual(SETTINGS_KEYS, ['SIGNIN_WORKSPACE', 'SIGNIN_DATA_DIR', 'SIGNIN_CUSTOMER_CONFIG']);
  withFile('PINGONE_CLIENT_SECRET=hunter2hunter2\nMODE=live\nPORT=9999\nSIGNIN_BIND=0.0.0.0\nSIGNIN_WORKSPACE=acme\n# a comment\nOTHER_APP_TOKEN="x y"\n', (f) => {
    assert.deepEqual(readSharedSettings(f), { SIGNIN_WORKSPACE: 'acme' });
    const env = { HOME: '/x' };
    applySharedSettings(env, f);
    assert.deepEqual(Object.keys(env).sort(), ['HOME', 'SIGNIN_WORKSPACE']);
    assert.equal(env.SIGNIN_WORKSPACE, 'acme');
  });
});

test('the environment wins over the file; a missing, empty or unreadable file is the defaults', () => {
  withFile('SIGNIN_WORKSPACE=acme\n', (f) => assert.equal(applySharedSettings({ SIGNIN_WORKSPACE: 'other' }, f).SIGNIN_WORKSPACE, 'other'));
  assert.deepEqual(readSharedSettings('/nonexistent/.env'), {});
  withFile('', (f) => assert.deepEqual(readSharedSettings(f), {}));
  withFile('SIGNIN_WORKSPACE=\n', (f) => assert.deepEqual(readSharedSettings(f), {}));
  assert.deepEqual(readSharedSettings(os.tmpdir()), {}, 'a directory is not a settings file');
});

test('the settings path is ~/Development/.env, or STANDALONE_ENV; there is no per-app .env loader', () => {
  assert.equal(settingsPath({ STANDALONE_ENV: '/x/y.env' }), '/x/y.env');
  assert.equal(settingsPath({}), path.join(os.homedir(), 'Development', '.env'));
  const root = path.resolve(import.meta.dirname, '../..');
  for (const f of ['server/src/index.js', 'scripts/doctor.mjs', 'e2e/start-server.mjs']) assert.doesNotMatch(fs.readFileSync(path.join(root, f), 'utf8'), /loadEnvFile/, f);
});
