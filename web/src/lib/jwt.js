// Decode only, for display. The mock signs with a throwaway HS256 key that this page never sees, so nothing is verified here.
// Rule 24b: segment decoding is the shared pane's (null-on-error kept).
import { decodeSegment } from "../components/JsonPane.jsx";
export function decodeJwt(token) {
  try {
    const [h, p, s] = String(token).split(".");
    if (!h || !p) return null;
    const header = decodeSegment(h);
    const payload = decodeSegment(p);
    if (!header || !payload) return null;
    return { header, payload, signature: s || "", parts: [h, p, s || ""] };
  } catch { return null; }
}
export const when = (secs) => (Number.isFinite(Number(secs)) ? new Date(Number(secs) * 1000).toISOString() : String(secs));
