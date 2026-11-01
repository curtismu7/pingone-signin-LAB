// Rule 17: the lab's diagrams are diagram-studio/1 data, checked by the vendored studio validator.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateDiagram, SCHEMA } from '../src/vendor/diagram-validate.js';
import { DIAGRAM_IDS, loadDiagrams } from '../src/diagrams.js';
import { withServer, rawHttp } from './helpers.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '../data/diagrams');
const file = (id) => JSON.parse(fs.readFileSync(path.join(DATA, `${id}.json`), 'utf8'));
const BOX_SIDE = { browser: [0, 70], bff: [330, 40], op: [660, 40], rs: [330, 340], phone: [660, 340] }; // where the lab has always drawn its five boxes

test('the vendored validator keeps its provenance header and its body is pinned', () => {
  const text = fs.readFileSync(path.join(HERE, '../src/vendor/diagram-validate.js'), 'utf8');
  const lines = text.split('\n');
  assert.match(lines[0], /^\/\/ Vendored from the diagram-studio repo \(core\/src\/validate\.js\) at commit [0-9a-f]{7,40} \(repo HEAD [0-9a-f]{7,40}\), copied \d{4}-\d{2}-\d{2}\.$/);
  assert.match(lines[1], /^\/\/ Byte-for-byte apart from these header lines\./);
  const body = lines.slice(2).join('\n');
  assert.equal(createHash('sha256').update(body).digest('hex'), '23afa6cd58d711df074e59654b6f7d3c99266a36bf5762e41f7b0b930262c0e7', 'the vendored body changed: re-vendor from the studio instead of editing');
  assert.equal(SCHEMA, 'diagram-studio/1');
});

test('every shipped diagram file is valid per the vendored validator, and ids match file names', () => {
  assert.deepEqual(fs.readdirSync(DATA).sort(), DIAGRAM_IDS.map((i) => `${i}.json`).sort());
  for (const id of DIAGRAM_IDS) {
    const d = file(id);
    assert.deepEqual(validateDiagram(d), [], id);
    assert.equal(d.id, id);
  }
});

test('the validator really rejects a broken diagram (so the test above can fail)', () => {
  const d = file(DIAGRAM_IDS[0]);
  d.steps[0].edges = [d.edges.length];
  assert.ok(validateDiagram(d).length > 0);
});

test('boxes sit where the lab always drew them, identically in all three files; steps point at real edges one to one', () => {
  for (const id of DIAGRAM_IDS) {
    const d = file(id);
    assert.deepEqual(Object.fromEntries(d.nodes.map((n) => [n.id, [n.x, n.y]])), BOX_SIDE, id);
    assert.equal(d.steps.length, d.edges.length, id);
    d.steps.forEach((s, i) => assert.deepEqual(s.edges, [i], `${id} step ${i + 1}`));
    assert.ok(d.steps.every((s) => s.what.length > 20));
  }
});

test('the honesty labels survive in the data', () => {
  assert.match(JSON.stringify(file('pingone-signin-login')), /UNVERIFIED for a real PingOne/);
  assert.match(JSON.stringify(file('pingone-signin-stepup')), /mock names/);
  assert.match(JSON.stringify(file('pingone-signin-ciba')), /mock limit/);
});

test('loadDiagrams refuses an invalid file and a file whose id does not match', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-'));
  for (const id of DIAGRAM_IDS) fs.copyFileSync(path.join(DATA, `${id}.json`), path.join(dir, `${id}.json`));
  assert.equal(loadDiagrams(dir).size, 3);
  const d = file(DIAGRAM_IDS[1]); d.edges[0].source = 'nobody';
  fs.writeFileSync(path.join(dir, `${DIAGRAM_IDS[1]}.json`), JSON.stringify(d));
  assert.throws(() => loadDiagrams(dir), /invalid/);
  const e = file(DIAGRAM_IDS[1]); e.id = 'pingone-signin-login';
  fs.writeFileSync(path.join(dir, `${DIAGRAM_IDS[1]}.json`), JSON.stringify(e));
  assert.throws(() => loadDiagrams(dir), /carries id/);
});

test('GET /api/diagrams lists the allowlist and /api/diagrams/:id serves exactly the file', async () => {
  await withServer(async (base) => {
    assert.deepEqual((await (await fetch(`${base}/api/diagrams`)).json()).ids, DIAGRAM_IDS);
    for (const id of DIAGRAM_IDS) {
      const r = await fetch(`${base}/api/diagrams/${id}`);
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), file(id));
    }
    assert.equal((await fetch(`${base}/api/diagrams/${DIAGRAM_IDS[0]}`, { method: 'POST' })).status, 404);
  });
});

test('traversal, odd ids and unknown names are refused', async () => {
  await withServer(async (base) => {
    const bad = ['..%2F..%2Fpackage', '%2e%2e%2f%2e%2e%2fpackage', 'pingone-signin-login.json', 'PINGONE-SIGNIN-LOGIN', 'nope', '..', '%00', 'pingone-signin-login%00', '__proto__', 'constructor', 'a'.repeat(300)];
    for (const id of bad) {
      const r = await rawHttp(`${base}/api/diagrams/${id}`);
      assert.ok([400, 404].includes(r.status), `${id} -> ${r.status}`);
      assert.doesNotMatch(r.text, /"schema"/, id);
    }
  });
});
