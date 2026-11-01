import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockOP, parseTraceparent, formatTraceparent, newTraceId, newSpanId, replyTraceparent, traceparentSource } from '../src/index.js';
import { lab, MOCK_PASSWORD } from './helpers.js';

const TP = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;

test('traceparent: format, parse and the reply keep the trace id and change the span id', () => {
  const t = formatTraceparent({ traceId: newTraceId(), spanId: newSpanId() });
  assert.match(t, TP);
  const p = parseTraceparent(t);
  assert.equal(formatTraceparent(p), t);
  const reply = parseTraceparent(replyTraceparent(t));
  assert.equal(reply.traceId, p.traceId);
  assert.notEqual(reply.spanId, p.spanId);
  for (const bad of [undefined, null, 5, '', 'x', `00-${'0'.repeat(32)}-${'a'.repeat(16)}-01`, `00-${'a'.repeat(32)}-${'0'.repeat(16)}-01`, `ff-${'a'.repeat(32)}-${'b'.repeat(16)}-01`, t.toUpperCase(), `${t}-extra`]) {
    assert.equal(parseTraceparent(bad), null, String(bad));
    assert.equal(replyTraceparent(bad), null);
  }
});

test('the mock answers a valid traceparent with the same trace id and a new span id, and ignores a bad one', () => {
  const op = createMockOP();
  const t = formatTraceparent({ traceId: newTraceId(), spanId: newSpanId() });
  const r = op.handle({ method: 'GET', path: '/nope', headers: { traceparent: t } });
  assert.equal(r.status, 404);
  assert.equal(parseTraceparent(r.headers.traceparent).traceId, parseTraceparent(t).traceId);
  assert.notEqual(r.headers.traceparent, t);
  assert.equal(op.handle({ method: 'GET', path: '/nope', headers: { traceparent: 'junk' } }).headers.traceparent, undefined);
  assert.equal(op.handle({ method: 'GET', path: '/nope' }).headers.traceparent, undefined);
});

test('every request a driver makes carries a traceparent (one trace, a new span per hop) and every answer echoes it', async () => {
  const { driver, ciba } = lab();
  const d = driver();
  const r = await d.run({ username: 'mark', passwords: [MOCK_PASSWORD] });
  assert.ok(r.ok);
  assert.ok(d.trace.length >= 4);
  const traceIds = new Set(); const spans = new Set();
  for (const e of d.trace) {
    assert.match(e.request.headers.traceparent, TP, `request ${e.n}`);
    assert.match(e.response.headers.traceparent, TP, `response ${e.n}`);
    const q = parseTraceparent(e.request.headers.traceparent); const a = parseTraceparent(e.response.headers.traceparent);
    assert.equal(a.traceId, q.traceId);
    assert.notEqual(a.spanId, q.spanId);
    traceIds.add(q.traceId); spans.add(q.spanId);
  }
  assert.equal(traceIds.size, 1);
  assert.equal(spans.size, d.trace.length);
  const c = ciba();
  await c.start({ loginHint: 'mark', bindingMessage: 'AB12' });
  await c.phone('approve'); await c.poll();
  for (const e of c.trace) assert.match(e.request.headers.traceparent, TP);
  assert.equal(traceparentSource().next().length, 55);
});
