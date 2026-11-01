// Scenario and vertical data, token rendering, and the text corpus the host scanner reads.
import fs from 'node:fs';
import { USERS, CLIENTS, DEFAULTS } from 'pingone-piflow-core';

const load = (f) => JSON.parse(fs.readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
export const SCENARIOS = load('scenarios.json');
export const VERTICALS = load('verticals.json');

export const getVertical = (id) => VERTICALS.find((v) => v.id === id);
export const getScenario = (key) => SCENARIOS.find((s) => s.id === key || s.slug === key);

export function castNames(v) {
  return Object.fromEntries(Object.entries(v.cast).map(([role, user]) => [role, USERS[user].name]));
}
// The words a story may use: {{cast.<role>}} is a person's display name, {{vocab.<key>}} a word of the vertical, which a customer's
// vocabulary may override. Anything else is an undefined token and is left visible as written (a test and the doctor catch it).
export function vocabFor(v, customer = {}) { return { ...(v.vocab || {}), ...(customer.vocabulary || {}), ...(customer.name ? { org: customer.name } : {}) }; }
export function tokenTable(v, customer = {}) {
  return { ...Object.fromEntries(Object.entries(castNames(v)).map(([k, n]) => [`cast.${k}`, n])), ...Object.fromEntries(Object.entries(vocabFor(v, customer)).map(([k, w]) => [`vocab.${k}`, w])) };
}
export const tokensIn = (text) => [...String(text).matchAll(/\{\{([^{}]*)\}\}/g)].map((m) => m[1]);
export function undefinedTokens(text, v, customer = {}) {
  const table = tokenTable(v, customer);
  return tokensIn(text).filter((t) => !Object.hasOwn(table, t));
}
export function renderText(text, v, customer = {}) {
  const table = tokenTable(v, customer);
  return String(text).replace(/\{\{([^{}]*)\}\}/g, (m, k) => (Object.hasOwn(table, k) ? table[k] : m));
}
export function renderScenario(s, v, customer = {}) {
  return { ...s, title: renderText(s.title, v, customer), takeaway: renderText(s.takeaway, v, customer) };
}

// Everything shipped as text that could carry a host: scenario data, verticals, seeded users and clients, defaults.
export function storyCorpus() {
  return [
    ...SCENARIOS.map((s) => ({ where: `scenario ${s.id}`, text: JSON.stringify(s) })),
    ...VERTICALS.map((v) => ({ where: `vertical ${v.id}`, text: JSON.stringify(v) })),
    { where: 'core seed users', text: JSON.stringify(USERS) },
    { where: 'core seed clients', text: JSON.stringify(CLIENTS) },
    { where: 'core defaults', text: JSON.stringify(DEFAULTS) },
  ];
}
