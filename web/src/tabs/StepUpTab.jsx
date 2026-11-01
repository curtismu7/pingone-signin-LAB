import React, { useCallback, useMemo, useRef, useState } from "react";
import { createTracer } from "../lib/trace.js";
import { PiFlowClient, callResource } from "../lib/flow.js";
import { parseChallenge } from "../lib/stepup.js";
import { Inert, pretty } from "../lib/Inert.jsx";
import { Mock, Pill, TokenView, TraceList, Unverified, Btn } from "../components/ui.jsx";

const INIT = { low: null, challenge: null, high: null, done: null, balance: null, error: null, busy: false };

export function useStepUp(catalog) {
  const [entries, setEntries] = useState([]);
  const tracer = useMemo(() => createTracer(setEntries), []);
  const [s, setS] = useState(INIT);
  const gen = useRef(0); // bumped by Start over: answers to calls started before it are dropped
  const user = catalog.cast[0].username;
  const creds = catalog.mockCredentials;
  const redirectUri = catalog.clients[0].redirectUri;
  // fn gets `put(patch)`, which applies the patch only if Start over has not been pressed since the call began.
  const run = useCallback(async (fn) => {
    const g = gen.current;
    const put = (patch) => { if (g === gen.current) setS((x) => ({ ...x, ...(typeof patch === "function" ? patch(x) : patch) })); };
    put({ busy: true, error: null });
    try { await fn(put); } catch (e) { put({ error: String(e.message || e) }); } finally { put({ busy: false }); }
  }, []);
  const login = (authorize) => new PiFlowClient({ tracer, redirectUri }).run({ username: user, password: creds.password, otp: creds.otp, authorize }).then((r) => (r.ok ? r : Promise.reject(new Error(`Sign-in stopped at ${r.stage}: ${r.error}`))));

  const signLow = useCallback(() => run(async (put) => { tracer.clear(); put({ ...INIT, busy: true }); const low = await login({ acr_values: "mock:single" }); put({ low }); }), [run, tracer]); // eslint-disable-line react-hooks/exhaustive-deps
  const callLow = useCallback(() => run(async (put) => {
    const r = await callResource(tracer, s.low.tokens.access_token, {}, parseChallenge);
    put({ challenge: r.challenge, done: r.status === 200 ? { status: 200, body: r.json } : null, error: r.status === 401 && r.challenge ? null : r.status === 200 ? null : `Unexpected answer ${r.status}` });
  }), [run, tracer, s.low]);
  const reauth = useCallback(() => run(async (put) => {
    const c = s.challenge;
    const high = await login({ acr_values: c.acr_values.join(" "), ...(c.max_age !== undefined ? { max_age: String(c.max_age) } : {}) });
    put({ high });
  }), [run, s.challenge]); // eslint-disable-line react-hooks/exhaustive-deps
  const retry = useCallback(() => run(async (put) => {
    const r = await callResource(tracer, s.high.tokens.access_token, {}, parseChallenge);
    put({ done: { status: r.status, body: r.json }, error: r.status === 200 ? null : `Retry answered ${r.status}` });
  }), [run, tracer, s.high]);
  const balance = useCallback(() => run(async (put) => {
    const t = (s.high || s.low).tokens.access_token;
    const r = await callResource(tracer, t, { path: "/rs/balance", method: "GET", note: "A read that asks for no more than the low acr: it works with either token." }, parseChallenge);
    put({ balance: { status: r.status, body: r.json } });
  }), [run, tracer, s.low, s.high]);
  const reset = useCallback(() => { gen.current += 1; tracer.clear(); setS(INIT); }, [tracer]);
  return { s, entries, signLow, callLow, reauth, retry, balance, reset, user };
}

function Step({ n, title, state, children }) {
  return (
    <li className={`step step--${state}`}>
      <div className="step__head"><span className="step__n" aria-hidden="true">{n}</span><h3>{title}</h3> {state === "done" && <Pill tone="ok">done</Pill>}</div>
      {children}
    </li>
  );
}

export default function StepUpTab({ app }) {
  const { catalog, stepup } = app;
  const { s } = stepup;
  const c = s.challenge;
  return (
    <div className="split">
      <div>
        <h2>Step-up (RFC 9470)</h2>
        <p className="lede">A resource server can refuse a token that proves too little. It answers 401 with a challenge that says what is missing, and the client signs in again with that. Here {catalog.cast[0].name} ({stepup.user}) signs in with a password only, tries a transfer, and gets sent up. <Unverified /> whether a real PingOne supports step-up this way.</p>
        <ol className="steps">
          <Step n="1" title="Sign in with a low acr" state={s.low ? "done" : "now"}>
            <p className="muted">Requests <code>acr_values=mock:single</code> <Mock>mock acr name</Mock>. Password only; the passcode step is skipped.</p>
            <Btn type="button" className="primary" disabled={s.busy} onClick={stepup.signLow}><span className="step-n" aria-hidden="true">1</span> {s.low ? "Sign in again (restarts)" : "Sign in (low acr)"}</Btn>
            {s.low && <p>Token acr: <code data-testid="low-acr">{s.low.id.payload.acr}</code>, amr: <code>{JSON.stringify(s.low.id.payload.amr)}</code></p>}
          </Step>
          <Step n="2" title="Call the resource with that token" state={s.challenge ? "done" : s.low ? "now" : "wait"}>
            <p className="muted"><code>POST /mock/rs/transfer</code> needs <code>mock:multi</code> and an authentication no older than 300 s (mock policy).</p>
            <div className="actions">
              <Btn type="button" className="primary" disabled={!s.low || s.busy} onClick={stepup.callLow}><span className="step-n" aria-hidden="true">2</span> Call POST /rs/transfer</Btn>
              <Btn type="button" disabled={!s.low || s.busy} onClick={stepup.balance}>Contrast: GET /rs/balance</Btn>
            </div>
            {s.balance && <p role="status" data-testid="balance">Balance read answered <strong>{s.balance.status}</strong>: it asks for no more than the token has.</p>}
            {c && (
              <div className="challenge" data-testid="challenge" role="status">
                <Pill tone="deny">401</Pill> <strong>Challenge parsed</strong> <span className="small muted">(from the <code>WWW-Authenticate</code> header)</span>
                <dl className="kv">
                  <dt>error</dt><dd><Inert text={c.error} /></dd>
                  {c.error_description && <><dt>description</dt><dd><Inert text={c.error_description} /></dd></>}
                  {c.acr_values && <><dt>acr_values</dt><dd data-testid="challenge-acr"><Inert text={c.acr_values.join(" ")} /> <Mock>mock acr name</Mock></dd></>}
                  {c.max_age !== undefined && <><dt>max_age</dt><dd data-testid="challenge-max-age">{c.max_age} s</dd></>}
                </dl>
              </div>
            )}
          </Step>
          <Step n="3" title="Re-authorize with what the challenge asked for" state={s.high ? "done" : c ? "now" : "wait"}>
            <p className="muted">A new pi.flow login carrying the challenge's <code>acr_values</code>{c?.max_age !== undefined ? " and max_age" : ""}. The user now has to pass the passcode step too (code {catalog.mockCredentials.otp}, mock).</p>
            <Btn type="button" className="primary" disabled={!c || s.busy || !!s.high} onClick={stepup.reauth}><span className="step-n" aria-hidden="true">3</span> Re-authorize (step up)</Btn>
            {s.high && <p>New token acr: <code data-testid="high-acr">{s.high.id.payload.acr}</code>, amr: <code>{JSON.stringify(s.high.id.payload.amr)}</code>, auth_time fresh.</p>}
          </Step>
          <Step n="4" title="Retry the call" state={s.done?.status === 200 ? "done" : s.high ? "now" : "wait"}>
            <Btn type="button" className="primary" disabled={!s.high || s.busy} onClick={stepup.retry}><span className="step-n" aria-hidden="true">4</span> Retry POST /rs/transfer</Btn>
            {s.done?.status === 200 && <p className="verdict ok" role="status" data-testid="retry-ok">200: <Inert text={JSON.stringify(s.done.body)} /></p>}
          </Step>
        </ol>
        {s.error && <p className="alert" role="alert" data-testid="stepup-error"><Inert text={s.error} /></p>}
        <div className="actions"><button type="button" onClick={stepup.reset}>Start over</button></div>
        <TokenView result={s.high || s.low} nonceSent={null} />
      </div>
      <aside aria-label="Trace pane" data-dev-only><TraceList entries={stepup.entries} title="Trace" /></aside>
    </div>
  );
}
