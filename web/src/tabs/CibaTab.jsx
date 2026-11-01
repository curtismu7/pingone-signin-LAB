import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createTracer } from "../lib/trace.js";
import { cibaPoll, cibaStart, phoneDecide, phonePending } from "../lib/ciba.js";
import { decodeJwt } from "../lib/jwt.js";
import { Inert } from "../lib/Inert.jsx";
import { Mock, Pill, TokenView, TraceList, Unverified, Btn } from "../components/ui.jsx";

const TERMINAL = new Set(["approved", "denied", "expired"]);
const INIT = { req: null, poll: { state: "idle", message: "", count: 0 }, interval: 5, result: null, error: null, busy: false, phoneAction: null, phoneError: null };
const problemText = (r) => `${r.json?.error || `HTTP ${r.status}`}: ${r.json?.error_description || r.json?.message || "refused"}`;

export function useCiba(catalog) {
  const [entries, setEntries] = useState([]);
  const tracer = useMemo(() => createTracer(setEntries), []);
  const [s, setS] = useState(INIT);
  const [auto, setAuto] = useState(false);
  const gen = useRef(0); // bumped by start() and reset(): answers to calls from an earlier request are dropped
  const set = (patch) => setS((x) => ({ ...x, ...patch }));

  const start = useCallback(async ({ loginHint, bindingMessage, requestedExpiry }) => {
    const g = ++gen.current;
    tracer.clear(); setAuto(false); setS({ ...INIT, busy: true });
    const r = await cibaStart(tracer, { loginHint, bindingMessage: bindingMessage || undefined, requestedExpiry: requestedExpiry || undefined });
    if (g !== gen.current) return;
    if (r.status === 200) setS({ ...INIT, req: { authReqId: r.json.auth_req_id, expiresIn: r.json.expires_in, startedAt: Date.now(), loginHint, bindingMessage }, interval: r.json.interval });
    else setS({ ...INIT, error: problemText(r) });
  }, [tracer]);

  const poll = useCallback(async () => {
    if (!s.req) return;
    const g = gen.current;
    const r = await cibaPoll(tracer, { authReqId: s.req.authReqId });
    if (g !== gen.current) return;
    const count = s.poll.count + 1;
    if (r.status === 200) { const id = decodeJwt(r.json.id_token); set({ poll: { state: "approved", message: "Approved on the phone. Tokens issued.", count }, result: { tokens: r.json, id, access: decodeJwt(r.json.access_token) } }); return; }
    const code = r.json?.error;
    const msg = r.json?.error_description || "";
    if (code === "authorization_pending") set({ poll: { state: "pending", message: msg, count } });
    else if (code === "slow_down") set({ interval: Number(/interval is now (\d+)s/.exec(msg)?.[1]) || s.interval + 5, poll: { state: "slow_down", message: msg, count } });
    else if (code === "access_denied") set({ poll: { state: "denied", message: msg, count } });
    else if (code === "expired_token") set({ poll: { state: "expired", message: msg, count } });
    else set({ poll: { state: "error", message: problemText(r), count } });
  }, [tracer, s.req, s.poll.count, s.interval]);

  const decide = useCallback(async (action) => {
    if (!s.req) return;
    const g = gen.current;
    const r = await phoneDecide(tracer, action, s.req.authReqId);
    if (g !== gen.current) return;
    if (r.status === 200) set({ phoneAction: action, phoneError: null });
    else set({ phoneError: problemText(r) });
  }, [tracer, s.req]);

  const reset = useCallback(() => { gen.current += 1; tracer.clear(); setAuto(false); setS(INIT); }, [tracer]);
  return { s, entries, auto, setAuto, start, poll, decide, reset };
}

function MockPhone({ ciba }) {
  const { s } = ciba;
  const [pending, setPending] = useState([]);
  const hint = s.req?.loginHint;
  useEffect(() => {
    if (!hint || s.phoneAction || TERMINAL.has(s.poll.state)) { if (!hint) setPending([]); return undefined; }
    let live = true;
    const tick = () => phonePending(hint).then((p) => live && setPending(p.filter((x) => x.auth_req_id === s.req.authReqId))).catch(() => {});
    tick(); const t = setInterval(tick, 1000);
    return () => { live = false; clearInterval(t); };
  }, [hint, s.req, s.phoneAction, s.poll.state]);
  const n = pending[0];
  return (
    <section className="phone" aria-label="Mock phone" data-testid="phone">
      <p className="phone__tag"><Mock>MOCK PHONE</Mock> stands in for the user's device</p>
      <div className="phone__screen">
        {s.phoneAction ? (
          <p role="status" data-testid="phone-result">You tapped <strong>{s.phoneAction === "approve" ? "Approve" : "Deny"}</strong>.</p>
        ) : n ? (
          <div role="alert" data-testid="phone-notification">
            <p className="phone__title">Sign-in request</p>
            <p className="small">for <strong><Inert text={n.user} /></strong></p>
            <p className="phone__code">Code <strong data-testid="phone-binding"><Inert text={n.binding_message || "(none)"} /></strong></p>
            <div className="actions">
              <button type="button" className="primary" onClick={() => ciba.decide("approve")}><span className="step-n" aria-hidden="true">2</span> Approve</button>
              <button type="button" className="deny" onClick={() => ciba.decide("deny")}><span className="step-n" aria-hidden="true">2</span> Deny</button>
            </div>
          </div>
        ) : (
          <div>
            <p className="muted" role="status">{s.req ? (TERMINAL.has(s.poll.state) ? "No request waiting." : "Waiting for a notification…") : "No request yet. Start one on the left."}</p>
            <div className="actions" aria-label="Phone answers (greyed out until a request is waiting)">
              <Btn type="button" className="primary" disabled={true}><span className="step-n" aria-hidden="true">2</span> Approve</Btn>
              <Btn type="button" className="deny" disabled={true}><span className="step-n" aria-hidden="true">2</span> Deny</Btn>
            </div>
          </div>
        )}
        {s.phoneError && <p className="alert" role="alert" data-testid="phone-error"><Inert text={s.phoneError} /></p>}
      </div>
    </section>
  );
}

const LABEL = { idle: "not polled yet", pending: "authorization_pending", slow_down: "slow_down", approved: "approved", denied: "access_denied", expired: "expired_token", error: "error" };
const TONE = { idle: "hold", pending: "hold", slow_down: "hold", approved: "ok", denied: "deny", expired: "deny", error: "deny" };

export default function CibaTab({ app }) {
  const { catalog, ciba } = app;
  const { s } = ciba;
  const [hint, setHint] = useState(catalog.cast[0].username);
  const [binding, setBinding] = useState("");
  const [expiry, setExpiry] = useState("");
  const max = catalog.limits.bindingMessageMax;
  const len = [...binding].length;
  const [left, setLeft] = useState(null);
  const pollRef = useRef(ciba.poll); pollRef.current = ciba.poll;

  useEffect(() => {
    if (!s.req) { setLeft(null); return undefined; }
    const upd = () => setLeft(Math.max(0, s.req.expiresIn - Math.floor((Date.now() - s.req.startedAt) / 1000)));
    upd(); const t = setInterval(upd, 1000); return () => clearInterval(t);
  }, [s.req]);
  useEffect(() => {
    if (!ciba.auto || !s.req || TERMINAL.has(s.poll.state)) return undefined;
    const t = setTimeout(() => pollRef.current(), s.interval * 1000);
    return () => clearTimeout(t);
  }, [ciba.auto, s.req, s.poll, s.interval]);

  const live = s.req && !TERMINAL.has(s.poll.state);
  return (
    <div className="split">
      <div>
        <h2>CIBA: backchannel sign-in <Mock>mock</Mock></h2>
        <p className="lede">The client asks the server to authenticate a user on their own device; nothing is shown in this browser except the polling. The phone on the right is a mock: it stands in for the PingOne mobile app.</p>

        <form className="card form" aria-label="Start a backchannel request" onSubmit={(e) => { e.preventDefault(); ciba.start({ loginHint: hint, bindingMessage: binding, requestedExpiry: expiry }); }}>
          <h3>1. Start the request</h3>
          <label className="field">login_hint
            <select value={hint} onChange={(e) => setHint(e.target.value)}>{catalog.cast.map((u) => <option key={u.username} value={u.username}>{u.username} ({u.name})</option>)}</select>
          </label>
          <label className="field">binding_message <Mock>8 character limit is mock</Mock> <Unverified />
            <input name="binding_message" value={binding} onChange={(e) => setBinding(e.target.value)} autoComplete="off" aria-describedby="bm-count" />
          </label>
          <p id="bm-count" className={`small ${len > max ? "over" : "muted"}`} aria-live="polite" data-testid="bm-count">{len} of {max} characters (mock limit){len > max ? ": over the limit, the server will refuse it" : ""}</p>
          <label className="field">requested_expiry, seconds (optional, 1 to 600)
            <input name="requested_expiry" type="number" min="1" max="600" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </label>
          <Btn type="submit" className="primary" disabled={s.busy}><span className="step-n" aria-hidden="true">1</span> Start (POST /bc-authorize)</Btn>
        </form>
        {s.error && <p className="alert" role="alert" data-testid="ciba-error"><Inert text={s.error} /></p>}

        {s.req && (
          <section className="card" aria-label="Polling">
            <h3>2. Poll the token endpoint</h3>
            <dl className="kv">
              <dt>auth_req_id</dt><dd><code data-testid="auth-req-id"><Inert text={s.req.authReqId} /></code></dd>
              <dt>interval</dt><dd data-testid="interval">{s.interval} s</dd>
              <dt>expires in</dt><dd data-testid="expires-in">{left}s</dd>
              <dt>polls so far</dt><dd>{s.poll.count}</dd>
            </dl>
            <p className="status" role="status" aria-live="polite" data-testid="poll-state">
              State: <Pill tone={TONE[s.poll.state]}>{LABEL[s.poll.state]}</Pill> <span className="muted small"><Inert text={s.poll.message} /></span>
            </p>
            <div className="actions">
              <Btn type="button" className="primary" disabled={!live} onClick={ciba.poll}><span className="step-n" aria-hidden="true">3</span> Poll now</Btn>
              <label className="check"><input type="checkbox" checked={ciba.auto} onChange={(e) => ciba.setAuto(e.target.checked)} disabled={!live} /> Poll automatically every {s.interval} s</label>
              <button type="button" onClick={ciba.reset}>Start over</button>
            </div>
            <p className="small muted">Press Poll now twice in a row to see <code>slow_down</code>: the mock then lengthens the interval by 5 s <Mock>+5 s is mock</Mock>.</p>
          </section>
        )}
        <TokenView result={s.result} nonceSent={null} />
      </div>
      <aside aria-label="Phone and trace">
        <MockPhone ciba={ciba} />
        <TraceList entries={ciba.entries} title="Trace" />
      </aside>
    </div>
  );
}
