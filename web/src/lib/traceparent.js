// W3C Trace Context for every request this page makes: traceparent = 00-<32 hex trace id>-<16 hex span id>-01.
// One trace id per run (a tracer, or the page itself for plain API calls); a new span id for every hop.
const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
const nonZero = (n) => { let h; do h = hex(n); while (/^0+$/.test(h)); return h; };

export const TRACEPARENT_RE = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;
export const newTraceId = () => nonZero(16);
export function traceparentSource(traceId = newTraceId()) {
  return { traceId, next: () => `00-${traceId}-${nonZero(8)}-01` };
}
const pageTrace = traceparentSource();
export const pageTraceparent = () => pageTrace.next();
