// Decode only, for display. The mock signs with a throwaway HS256 key that this page never sees, so nothing is verified here.
const unb64 = (s) => {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};
export function decodeJwt(token) {
  try {
    const [h, p, s] = String(token).split(".");
    if (!h || !p) return null;
    return { header: JSON.parse(unb64(h)), payload: JSON.parse(unb64(p)), signature: s || "", parts: [h, p, s || ""] };
  } catch { return null; }
}
export const when = (secs) => (Number.isFinite(Number(secs)) ? new Date(Number(secs) * 1000).toISOString() : String(secs));
