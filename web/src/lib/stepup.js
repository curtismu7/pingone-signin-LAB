// RFC 9470 challenge parsing for the page. The acr strings in it are the MOCK's own (mock:single, mock:multi).
export function parseChallenge(value) {
  const m = /^\s*Bearer\s+(.*)$/is.exec(String(value || ""));
  if (!m) return null;
  const params = {};
  const re = /([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))\s*(?:,\s*|$)/gy;
  let p;
  while ((p = re.exec(m[1])) !== null) params[p[1].toLowerCase()] = p[2] !== undefined ? p[2].replace(/\\(.)/g, "$1") : p[3];
  if (!params.error) return null;
  const out = { scheme: "Bearer", error: params.error };
  if (params.error_description) out.error_description = params.error_description;
  if (params.acr_values) out.acr_values = params.acr_values.split(/\s+/).filter(Boolean);
  if (params.max_age !== undefined && /^\d+$/.test(params.max_age)) out.max_age = Number(params.max_age);
  return out;
}
