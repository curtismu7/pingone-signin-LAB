// W3C Trace Context `traceparent` (version 00): 00-<32 hex trace id>-<16 hex parent id>-<2 hex flags>. Dependency-free.
// One trace id per run; every hop gets its own span id. The mock echoes the trace id with a new span id.
import { randomBytes } from 'node:crypto';

const RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const hex = (n, zero) => { let id; do id = randomBytes(n).toString('hex'); while (id === zero); return id; };

export const newTraceId = () => hex(16, '0'.repeat(32));
export const newSpanId = () => hex(8, '0'.repeat(16));
export const formatTraceparent = ({ traceId, spanId, flags = '01' }) => `00-${traceId}-${spanId}-${flags}`;

// -> { traceId, spanId, flags } or null when malformed (wrong version, wrong length, all-zero ids, upper case).
export function parseTraceparent(value) {
  const m = typeof value === 'string' ? RE.exec(value) : null;
  if (!m || m[1] === '0'.repeat(32) || m[2] === '0'.repeat(16)) return null;
  return { traceId: m[1], spanId: m[2], flags: m[3] };
}

// A source of traceparent values for one run: same trace id, a fresh span id per call.
export function traceparentSource(traceId = newTraceId()) {
  return { traceId, next: () => formatTraceparent({ traceId, spanId: newSpanId() }) };
}

// The answer's traceparent for a request's: same trace id and flags, new span id. null when the request had none (or a bad one).
export function replyTraceparent(inbound) {
  const p = parseTraceparent(inbound);
  return p ? formatTraceparent({ traceId: p.traceId, spanId: newSpanId(), flags: p.flags }) : null;
}
