// RFC 9470 step-up challenge: build and parse the WWW-Authenticate Bearer value, and the mock resource server's policy.
// The acr strings here (mock:single, mock:multi) are FICTIONAL. Which acr strings a real PingOne issues is UNVERIFIED.
export const ACR = Object.freeze({ single: 'mock:single', multi: 'mock:multi' });
export const ACR_RANK = Object.freeze({ [ACR.single]: 1, [ACR.multi]: 2 });

const quote = (v) => `"${String(v).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export function buildChallenge({ acrValues, maxAge, description } = {}) {
  const parts = ['error="insufficient_user_authentication"'];
  if (description) parts.push(`error_description=${quote(description)}`);
  if (acrValues && acrValues.length) parts.push(`acr_values=${quote(acrValues.join(' '))}`);
  if (Number.isInteger(maxAge) && maxAge >= 0) parts.push(`max_age=${quote(String(maxAge))}`);
  return `Bearer ${parts.join(', ')}`;
}

// -> { scheme:'Bearer', error, error_description?, acr_values?: string[], max_age?: number } or null.
export function parseChallenge(value) {
  const m = /^\s*Bearer\s+(.*)$/is.exec(String(value || ''));
  if (!m) return null;
  const params = {};
  const re = /([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))\s*(?:,\s*|$)/gy;
  let p;
  while ((p = re.exec(m[1])) !== null) params[p[1].toLowerCase()] = p[2] !== undefined ? p[2].replace(/\\(.)/g, '$1') : p[3];
  if (!params.error) return null;
  const out = { scheme: 'Bearer', error: params.error };
  if (params.error_description) out.error_description = params.error_description;
  if (params.acr_values) out.acr_values = params.acr_values.split(/\s+/).filter(Boolean);
  if (params.max_age !== undefined && /^\d+$/.test(params.max_age)) out.max_age = Number(params.max_age);
  return out;
}

// What the mock resource server demands of a token's authentication event. Returns null when satisfied,
// else { acrValues?, maxAge?, description }. Only the failing parts are put in the challenge.
export function stepUpNeeded(claims, { requireAcr, maxAgeS, nowMs }) {
  const out = {}; const why = [];
  const rank = (acr) => (typeof acr === 'string' && Object.hasOwn(ACR_RANK, acr) ? ACR_RANK[acr] : 0);
  if (rank(claims.acr) < rank(requireAcr)) { out.acrValues = [requireAcr]; why.push(`acr ${claims.acr || 'none'} is below ${requireAcr}`); }
  const age = Math.floor(nowMs / 1000) - Number(claims.auth_time);
  if (!Number.isFinite(age) || age > maxAgeS) { out.maxAge = maxAgeS; why.push(`authentication is older than ${maxAgeS}s`); }
  if (!why.length) return null;
  out.description = why.join('; ');
  return out;
}
