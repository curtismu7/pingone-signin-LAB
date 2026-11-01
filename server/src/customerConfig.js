// Optional customer.config.json: re-skins the lab for one customer (name, default vertical, vocabulary, brand colours).
// The file may be shared with customers, so it never holds credentials: a key that looks like one is rejected. The default
// (no file) is fictional. Colours are applied in the page as CSS tokens (--accent, --on-accent), never as inline styles.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../customer.config.json');
const SECRETISH = /secret|password|token|key/i;
const HEX = /^#[0-9a-f]{6}$/i;
const TOP = ['name', 'vertical', 'vocabulary', 'brand'];
const BRAND = ['primary', 'primaryDark'];
const VOCAB_KEY = /^[a-z][a-zA-Z0-9]{0,20}$/;
export const MAX_BYTES = 64 * 1024;
export const MAX_VOCAB = 50;
export const MAX_DEPTH = 6;
const LIGHT_BG = '#fcfcfc'; const DARK_BG = '#172033'; // the shared stylesheet's page and card colours (the dark card is the lighter of the two dark surfaces)

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= max && !/[\u0000-\u001f\u007f<>]/.test(v);

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lin = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const luminance = (hex) => { const [r, g, b] = rgb(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
export function hue(hex) {
  const [r, g, b] = rgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: d / (1 - Math.abs(max + min - 1)) };
}
// House rule: no purple. Reject saturated colours whose hue is indigo, violet or magenta.
// Indigo counts: 230 is where blue turns toward violet (the house blues sit near 210).
export const isPurple = (hex) => { const { h, s } = hue(hex); return s > 0.12 && h >= 230 && h <= 335; };
const mixWhite = (hex, t) => `#${rgb(hex).map((c) => Math.round(c + (255 - c) * t).toString(16).padStart(2, '0')).join('')}`;
const onColour = (bg) => (contrast(bg, '#ffffff') >= contrast(bg, '#14171c') ? '#ffffff' : '#14171c');

// Deepest nesting of objects and arrays, found without recursion (a hostile file must not be able to overflow the stack).
export function depthOf(v, limit = MAX_DEPTH + 1) {
  let deepest = 0; const stack = [[v, 1]];
  while (stack.length) {
    const [x, d] = stack.pop();
    if (!x || typeof x !== 'object') continue;
    if (d > deepest) deepest = d;
    if (deepest > limit) return deepest;
    for (const c of Array.isArray(x) ? x : Object.values(x)) if (c && typeof c === 'object') stack.push([c, d + 1]);
  }
  return deepest;
}
// The same, on the raw text, before JSON.parse: counts brackets outside strings.
export function textDepth(text) {
  let d = 0; let max = 0; let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; } else if (c === '"') inStr = true; else if (c === '{' || c === '[') { d++; if (d > max) max = d; } else if (c === '}' || c === ']') d--;
  }
  return max;
}

function secretKeys(v, at, out) {
  if (!isObject(v)) return;
  for (const [k, child] of Object.entries(v)) {
    const here = at ? `${at}.${k}` : k;
    if (SECRETISH.test(k)) out.push(`${here}: key name looks like a credential (this file must never hold secrets)`);
    secretKeys(child, here, out);
  }
}

// Pure check of a parsed file -> { config, errors }. config is the sanitized object (with computed on-colours) only when errors is empty.
export function validateCustomerConfig(raw, { verticals = null } = {}) {
  const errors = [];
  if (!isObject(raw)) return { config: {}, errors: ['file: must be a JSON object'] };
  if (depthOf(raw) > MAX_DEPTH) return { config: {}, errors: [`file: nested deeper than ${MAX_DEPTH} levels`] };
  if (Object.keys(raw).length > 20) return { config: {}, errors: ['file: more than 20 top-level fields'] };
  if (isObject(raw.vocabulary) && Object.keys(raw.vocabulary).length > MAX_VOCAB) return { config: {}, errors: [`vocabulary: more than ${MAX_VOCAB} words`] };
  secretKeys(raw, '', errors);
  if (errors.length) return { config: {}, errors };
  for (const k of Object.keys(raw)) if (!TOP.includes(k)) errors.push(`${k}: unknown field`);
  const config = {};
  if (raw.name !== undefined) { if (text(raw.name, 40)) config.name = raw.name.trim(); else errors.push('name: must be 1-40 plain characters'); }
  if (raw.vertical !== undefined) {
    if (typeof raw.vertical === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(raw.vertical) && (!verticals || verticals.includes(raw.vertical))) config.vertical = raw.vertical;
    else errors.push(`vertical: must be one of ${verticals ? verticals.join(', ') : 'the vertical pack ids'}`);
  }
  if (raw.vocabulary !== undefined) {
    if (!isObject(raw.vocabulary)) errors.push('vocabulary: must be an object of word key to text');
    else {
      config.vocabulary = {};
      for (const [k, w] of Object.entries(raw.vocabulary)) {
        if (!VOCAB_KEY.test(k)) errors.push(`vocabulary.${k}: key must be a camelCase word`);
        else if (!text(w, 40)) errors.push(`vocabulary.${k}: must be 1-40 plain characters`);
        else config.vocabulary[k] = w.trim();
      }
    }
  }
  if (raw.brand !== undefined) {
    if (!isObject(raw.brand)) errors.push('brand: must be an object');
    else {
      const b = {};
      for (const [k, v] of Object.entries(raw.brand)) {
        if (!BRAND.includes(k)) errors.push(`brand.${k}: unknown field`);
        else if (typeof v !== 'string' || !HEX.test(v)) errors.push(`brand.${k}: must be a #rrggbb colour`);
        else if (isPurple(v)) errors.push(`brand.${k}: purple is not allowed in this kit's palette`);
        else b[k] = v.toLowerCase();
      }
      if (b.primary && contrast(b.primary, LIGHT_BG) < 3) errors.push('brand.primary: too light for the light theme (needs contrast of at least 3:1 with the page)');
      const dark = b.primaryDark || (b.primary ? mixWhite(b.primary, 0.35) : null);
      if (dark && contrast(dark, DARK_BG) < 3) errors.push('brand.primaryDark: too dark for the dark theme (needs contrast of at least 3:1 with the page)');
      if (b.primary || b.primaryDark) {
        config.brand = {
          ...(b.primary ? { primary: b.primary, onPrimary: onColour(b.primary) } : {}),
          ...(dark ? { primaryDark: dark, onPrimaryDark: onColour(dark) } : {}),
        };
      }
    }
  }
  return errors.length ? { config: {}, errors } : { config, errors };
}

// The config for this moment, re-read when the file changes. -> { config, errors, file, present }
let cache = { file: null, stamp: null, result: null };
export function loadCustomerConfig({ file = process.env.SIGNIN_CUSTOMER_CONFIG || DEFAULT_FILE, verticals = null } = {}) {
  let stamp;
  try { const st = fs.statSync(file); stamp = `${st.mtimeMs}:${st.size}`; } catch { return { config: {}, errors: [], file, present: false }; }
  if (cache.file === file && cache.stamp === stamp && cache.verticals === String(verticals)) return cache.result;
  let result;
  try {
    const size = Number(stamp.split(':')[1]);
    if (size > MAX_BYTES) result = { config: {}, errors: [`file: larger than ${MAX_BYTES} bytes (${size})`], file, present: true };
    else {
      const text = fs.readFileSync(file, 'utf8');
      if (textDepth(text) > MAX_DEPTH) result = { config: {}, errors: [`file: nested deeper than ${MAX_DEPTH} levels`], file, present: true };
      else result = { ...validateCustomerConfig(JSON.parse(text), { verticals }), file, present: true };
    }
  } catch (e) { result = { config: {}, errors: [e instanceof SyntaxError ? `file: not valid JSON (${String(e.message).slice(0, 80)})` : `file: could not be read (${e.name})`], file, present: true }; }
  cache = { file, stamp, verticals: String(verticals), result };
  return result;
}
