// Runs a scenario against a fresh in-process mock and compares what happened with what the data file says should happen.
import { SCENARIOS, VERTICALS, getScenario, getVertical, renderScenario } from './stories.js';
import { IMPLS, makeLab } from './scenarios.js';

export function matches(expected, actual) {
  return Object.entries(expected).every(([k, v]) => actual[k] === v);
}

export async function runScenario(key, verticalId = VERTICALS[0].id, customer = {}) {
  const s = getScenario(key); const v = getVertical(verticalId);
  if (!s) throw new Error(`unknown scenario ${key}`);
  if (!v) throw new Error(`unknown vertical ${verticalId}`);
  const l = makeLab();
  const r = renderScenario(s, v, customer);
  let actual; let error = null;
  try { actual = await IMPLS[s.slug]({ l, cast: v.cast }); } catch (e) { actual = { outcome: 'crashed' }; error = e.message; }
  return {
    id: r.id, slug: r.slug, kind: r.kind, title: r.title, takeaway: r.takeaway, vertical: v.id,
    pass: error === null && matches(s.expect, actual), expected: s.expect, actual, ...(error ? { error } : {}), trace: l.tracer.entries,
  };
}

export async function runAll(verticalId = VERTICALS[0].id, customer = {}) {
  const out = [];
  for (const s of SCENARIOS) out.push(await runScenario(s.id, verticalId, customer));
  return out;
}
