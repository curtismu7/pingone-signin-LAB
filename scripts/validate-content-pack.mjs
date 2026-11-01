#!/usr/bin/env node
// Validates content-pack.json the way the Learning Hub's loader does: the same JSON Schema, then the same checks a schema cannot
// express (caps, control characters, token-shaped strings, id shape and uniqueness, http(s) links, route paths, cross-references).
// The checks were read from the hub's server/src/validate.js and are copied here, not imported: keep them in step when the hub changes.
//   node scripts/validate-content-pack.mjs [path/to/content-pack.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SUPPORTED_SCHEMA = 'demo-content-pack/1';
const MAX_PACK_BYTES = 5 * 1024 * 1024;
const MAX_STRING = 8000;
const MAX_ITEMS = 5000;
const MAX_PROBLEMS = 20;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/; // no "." (it is the namespace separator)
const CONTROL = /[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const JWT_SHAPE = /eyJ[A-Za-z0-9_-]{10,}\./;

function walk(v, at, problems) {
  if (typeof v === 'string') {
    if (v.length > MAX_STRING) problems.push(`${at}: string longer than ${MAX_STRING} characters`);
    else if (CONTROL.test(v)) problems.push(`${at}: contains control characters`);
    else if (JWT_SHAPE.test(v)) problems.push(`${at}: looks like a raw token; packs must not carry tokens`);
  } else if (Array.isArray(v)) {
    if (v.length > MAX_ITEMS) problems.push(`${at}: more than ${MAX_ITEMS} items`);
    else v.forEach((x, i) => walk(x, `${at}/${i}`, problems));
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) walk(x, `${at}/${k}`, problems);
  }
}
const httpUrl = (s) => { try { const u = new URL(s); return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password; } catch { return false; } };
const routePath = (s) => typeof s === 'string' && s.startsWith('/') && !s.startsWith('//') && !/[\\\0-\x1f]/.test(s);
const relPath = (s) => typeof s === 'string' && s && !s.startsWith('/') && !/[\\\0-\x1f]/.test(s) && !s.split('/').includes('..');

function uniqueIds(list, label, problems) {
  const seen = new Set();
  list.forEach((x, i) => {
    if (!ID_RE.test(x.id)) problems.push(`/${label}/${i}/id: must match ${ID_RE}`);
    else if (seen.has(x.id)) problems.push(`/${label}/${i}/id: duplicate id "${x.id}"`);
    seen.add(x.id);
  });
  return seen;
}

// -> array of problem strings; empty means valid.
export function validatePack(pack, schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/content-pack.schema.json'), 'utf8'))) {
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) return ['pack must be a JSON object'];
  if (typeof pack.schema === 'string' && pack.schema !== SUPPORTED_SCHEMA) return [`unsupported pack schema "${pack.schema.slice(0, 60)}"; the hub reads ${SUPPORTED_SCHEMA} only`];
  const problems = [];
  walk(pack, '', problems);
  if (problems.length) return problems.slice(0, MAX_PROBLEMS);
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const check = ajv.compile(schema);
  if (!check(pack)) return check.errors.slice(0, MAX_PROBLEMS).map((e) => `${e.instancePath || '/'} ${e.message}`);
  const terms = uniqueIds(pack.glossary, 'glossary', problems);
  const sources = uniqueIds(pack.sources, 'sources', problems);
  uniqueIds(pack.cards, 'cards', problems);
  if (pack.diagrams) uniqueIds(pack.diagrams, 'diagrams', problems);
  const stories = pack.stories ? uniqueIds(pack.stories, 'stories', problems) : new Set();
  if (pack.documents) uniqueIds(pack.documents, 'documents', problems);
  pack.sources.forEach((s, i) => { if (!httpUrl(s.url)) problems.push(`/sources/${i}/url: must be an http(s) URL`); });
  pack.cards.forEach((c, i) => {
    const h = c.action.href;
    if (c.action.type === 'external' ? !httpUrl(h) : !routePath(h)) problems.push(`/cards/${i}/action/href: ${c.action.type === 'external' ? 'must be an http(s) URL' : 'must be a path starting with a single "/"'}`);
    for (const t of c.terms || []) if (!terms.has(t)) problems.push(`/cards/${i}/terms: unknown glossary id "${t}"`);
    if (c.story && !stories.has(c.story)) problems.push(`/cards/${i}/story: unknown story id "${c.story}"`);
  });
  (pack.diagrams || []).forEach((d, i) => { if (!routePath(d.href)) problems.push(`/diagrams/${i}/href: must be a path starting with a single "/"`); });
  (pack.documents || []).forEach((d, i) => {
    if (!relPath(d.path)) problems.push(`/documents/${i}/path: must be a relative path without ".."`);
    if (d.sourceId && !sources.has(d.sourceId)) problems.push(`/documents/${i}/sourceId: unknown source id "${d.sourceId}"`);
  });
  if (pack.demo.baseUrl && !httpUrl(pack.demo.baseUrl)) problems.push('/demo/baseUrl: must be an http(s) URL');
  if (pack.demo.doctor && !routePath(pack.demo.doctor)) problems.push('/demo/doctor: must be a path starting with a single "/"');
  return problems.slice(0, MAX_PROBLEMS);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] || path.join(ROOT, 'content-pack.json');
  let errors;
  if (fs.statSync(file).size > MAX_PACK_BYTES) errors = [`pack is larger than ${MAX_PACK_BYTES} bytes`];
  else { try { errors = validatePack(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { errors = [`not valid JSON: ${e.message}`]; } }
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log(`${file}: valid`);
}
