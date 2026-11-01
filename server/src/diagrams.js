// The lab's flow diagrams are diagram-studio/1 data files in server/data/diagrams. They are read and validated once, at startup, against the vendored
// studio validator, and served from memory by name. No request value ever reaches the file system, so there is nothing to traverse.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { validateDiagram } from './vendor/diagram-validate.js';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/diagrams');
export const DIAGRAM_IDS = ['pingone-signin-login', 'pingone-signin-stepup', 'pingone-signin-ciba']; // the fixed allowlist, in picker order
const ID = /^[a-z0-9][a-z0-9_-]*$/;

export function loadDiagrams(dir = DIR) {
  const out = new Map();
  for (const id of DIAGRAM_IDS) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'));
    const problems = validateDiagram(d);
    if (problems.length) throw new Error(`diagram ${id} is invalid: ${problems.join('; ')}`);
    if (d.id !== id) throw new Error(`diagram file ${id} carries id ${d.id}`);
    out.set(id, Object.freeze(d));
  }
  return out;
}

let shared = null; // the shipped files, read once per process (a hosted run makes one app per visitor)

// GET /api/diagrams -> { ids }, GET /api/diagrams/:id -> the diagram. Session-less and read-only, like /api/health.
export function createDiagramsRouter(diagrams = (shared ??= loadDiagrams())) {
  const r = express.Router();
  r.get('/', (_req, res) => res.json({ ids: DIAGRAM_IDS }));
  r.get('/:id', (req, res) => {
    const { id } = req.params;
    if (!ID.test(id) || !DIAGRAM_IDS.includes(id)) return res.status(404).json({ error: 'not_found' });
    res.json(diagrams.get(id));
  });
  r.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  return r;
}
