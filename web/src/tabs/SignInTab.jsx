import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createTracer } from "../lib/trace.js";
import { PiFlowClient } from "../lib/flow.js";
import { Inert } from "../lib/Inert.jsx";
import { Mock, Pill, TokenView, TraceList, Unverified, Btn } from "../components/ui.jsx";

const problem = (r) => {
  const j = r.json;
  const e = j && typeof j.error === "object" && j.error ? j.error : j || {};
  return { status: r.status, code: e.code || e.error || `HTTP ${r.status}`, message: e.message || e.error_description || "The mock refused the request.", attempts: j?.attempts || null };
};

export function useLogin(catalog) {
  const gen = useRef(0); // bumped by reset(): answers to calls started before it are dropped
  const [entries, setEntries] = useState([]);
  const tracer = useMemo(() => createTracer(setEntries), []);
  const client = useRef(null);
  const [v, setV] = useState({ status: "IDLE", flow: null, error: null, busy: false, result: null, code: null });
  const redirectUri = catalog.clients[0].redirectUri;

  const guard = useCallback(async (fn) => {
    const g = gen.current;
    setV((s) => ({ ...s, busy: true }));
    try { await fn(g); } finally { if (g === gen.current) setV((s) => ({ ...s, busy: false })); }
  }, []);
  const apply = (r, extra = {}) => setV((s) => ({ ...s, status: client.current.flow?.status ?? s.status, flow: client.current.flow, error: r.status === 200 ? null : problem(r), ...extra }));

  const start = useCallback((acrValues) => guard(async (g) => {
    tracer.clear();
    const c = new PiFlowClient({ tracer, redirectUri });
    client.current = c;
    const r = await c.authorize(acrValues ? { acr_values: acrValues } : {});
    if (g !== gen.current) return;
    setV({ status: r.status === 200 ? r.json.status : "IDLE", flow: client.current.flow, error: r.status === 200 ? null : problem(r), busy: false, result: null, code: null });
  }), [guard, tracer, redirectUri]);
  const submit = useCallback((kind, body) => guard(async (g) => { const r = await client.current.submit(kind, body); if (g === gen.current) apply(r); }), [guard]);
  const resume = useCallback(() => guard(async (g) => { const r = await client.current.resume(); if (g === gen.current) apply(r, r.status === 200 ? { status: "COMPLETED", code: r.json.code } : {}); }), [guard]);
  const exchange = useCallback(() => guard(async (g) => {
    const r = await client.current.exchange();
    if (g !== gen.current) return;
    if (r.status === 200) setV((s) => ({ ...s, status: "SIGNED_IN", error: null, result: { ...client.current.tokenResult(r.json), nonceSent: client.current.pkce.nonce } }));
    else setV((s) => ({ ...s, error: problem(r) }));
  }), [guard]);
  const reset = useCallback(() => { gen.current += 1; client.current = null; tracer.clear(); setV({ status: "IDLE", flow: null, error: null, busy: false, result: null, code: null }); }, [tracer]);
  return { v, entries, start, submit, resume, exchange, reset };
}

const STEPS = ["USERNAME_PASSWORD_REQUIRED", "DEVICE_SELECTION_REQUIRED", "OTP_REQUIRED", "RESUME_REQUIRED", "COMPLETED", "SIGNED_IN"];

export default function SignInTab({ app }) {
  const { catalog, login } = app;
  const { v } = login;
  const [username, setUsername] = useState(catalog.cast[0].username);
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [device, setDevice] = useState("");
  const [acr, setAcr] = useState("");
  const stage = useRef(null);

  // Focus follows the flow: when the status changes (not on first load, so the skip link stays the first Tab stop) the first control of
  // the new step gets focus. After a refused attempt, focus goes back to the form only if it is not on an input (the clicked button was
  // disabled while the request ran); it never leaves an input the user has already moved to.
  const focusedFor = useRef("IDLE");
  useEffect(() => {
    if (v.busy) return;
    const lost = !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || ""); // on a button (disabled while the request ran) or nowhere
    if (focusedFor.current !== v.status) { focusedFor.current = v.status; stage.current?.querySelector("[data-autofocus]")?.focus(); }
    else if (v.error && lost) (stage.current?.querySelector("input[name=password], input[name=otp]") || stage.current?.querySelector("[data-autofocus]"))?.focus();
  }, [v.status, v.error, v.busy]);
  useEffect(() => { if (v.flow?._embedded?.devices) setDevice(v.flow._embedded.devices[0].id); }, [v.flow]);
  useEffect(() => { if (v.status === "IDLE") { setPassword(""); setOtp(""); } }, [v.status]);

  const mc = catalog.mockCredentials;
  const onPassword = (e) => { e.preventDefault(); login.submit("password", { username, password }); setPassword(""); };

  return (
    <div className="split">
      <div>
        <h2>Sign in with pi.flow</h2>
        <p className="lede">A real embedded form, driven one request at a time against the live mock. The page plays the BFF: it keeps the PKCE verifier and sends the session-token cookie. There is no redirect to a hosted login page.</p>

        <section className="card" aria-label="Why pi.flow">
          <h3>Why pi.flow, and how it differs from a redirect login</h3>
          <table className="claims">
            <thead><tr><th scope="col">Step</th><th scope="col">Redirect login (no response_mode)</th><th scope="col">pi.flow (response_mode=pi.flow)</th></tr></thead>
            <tbody>
              <tr><th scope="row">GET /authorize answers with</th><td>a 302 to the provider's login page</td><td>JSON: a flow id and a status such as USERNAME_PASSWORD_REQUIRED</td></tr>
              <tr><th scope="row">Who draws the login screen</th><td>the provider, on its own page</td><td>this app, from the status the flow returns</td></tr>
              <tr><th scope="row">Where the password goes</th><td>typed on the provider's page; this app never sees it</td><td>POSTed by this app to /flows/{"{id}"}; this app handles it</td></tr>
              <tr><th scope="row">How the user returns</th><td>a redirect back to the redirect_uri with a code</td><td>the user never leaves; GET /resume returns the code</td></tr>
            </tbody>
          </table>
          <p className="small muted">Why use it: the login stays in your own UI, so it can be branded and explained one step at a time, with no browser hop. The cost: your app now handles the credentials, so it must protect them. This lab is pi.flow only: an authorize request without response_mode=pi.flow is refused. PingOne behaviour behind these steps is UNVERIFIED here.</p>
        </section>

        <section className="card" aria-label="Seeded users">
          <h3>Seeded users <Mock>fictional</Mock></h3>
          <p className="small muted">Password for all: <code data-testid="mock-password">{mc.password}</code>. One-time passcode: <code data-testid="mock-otp">{mc.otp}</code>. Both are throwaway values for this process only.</p>
          <table className="claims">
            <thead><tr><th scope="col">User</th><th scope="col">Name</th><th scope="col">MFA</th><th scope="col"><span className="sr">Action</span></th></tr></thead>
            <tbody>
              {catalog.cast.map((u) => (
                <tr key={u.username}>
                  <th scope="row">{u.username}</th>
                  <td>{u.name}</td>
                  <td>{u.mfa ? `always, ${u.devices} device${u.devices > 1 ? "s" : ""}` : "only if the acr asks"}</td>
                  <td><button type="button" className="primary" onClick={() => { setUsername(u.username); setPassword(mc.password); }} aria-label={`Fill in ${u.username} and the password`}>Use</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card" aria-label="Flow" ref={stage}>
          <p className="status" role="status" aria-live="polite" data-testid="flow-status">
            Flow status: <strong>{v.status === "IDLE" ? "no flow open" : v.status}</strong> <Mock>mock status names</Mock> <Unverified />
          </p>
          <ol className="stepper" aria-label="Flow progress">
            {STEPS.map((s) => <li key={s} className={s === v.status ? "is-here" : STEPS.indexOf(s) < STEPS.indexOf(v.status) ? "is-done" : ""}>{s}</li>)}
          </ol>
          {v.error && (
            <div className="alert" role="alert" data-testid="flow-error">
              <strong><Inert text={v.error.code} /></strong>: <Inert text={v.error.message} />
              {v.error.attempts && <> Attempts used {v.error.attempts.used} of {v.error.attempts.max}.</>}
            </div>
          )}

          <ol className="steps-list" aria-label="Sign-in steps, in order">
            <li className="steps-list__item">
              <div className="steps-list__head"><span className="step-n" aria-hidden="true">1</span> Open the flow {v.status !== "IDLE" && <Pill tone="ok">done</Pill>}</div>
              <div className="controls">
                <label>acr_values <Mock>mock names</Mock>
                  <select value={acr} onChange={(e) => setAcr(e.target.value)} disabled={v.status !== "IDLE"} data-autofocus={v.status === "IDLE" || undefined}>
                    <option value="">(not sent)</option>
                    {catalog.acr.values.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </label>
                <Btn type="button" className="primary" disabled={v.busy || v.status !== "IDLE"} onClick={() => login.start(acr)}><span className="step-n" aria-hidden="true">1</span> Open the flow (GET /authorize?response_mode=pi.flow)</Btn>
              </div>
            </li>
            <li className="steps-list__item">
              <div className="steps-list__head"><span className="step-n" aria-hidden="true">2</span> Sign in {v.status === "RESUME_REQUIRED" || v.status === "COMPLETED" || v.status === "SIGNED_IN" ? <Pill tone="ok">done</Pill> : null}</div>
              <form onSubmit={onPassword} className="form" aria-label="Sign in">
                <label className="field">Username
                  <input name="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" disabled={v.status !== "USERNAME_PASSWORD_REQUIRED"} data-autofocus={v.status === "USERNAME_PASSWORD_REQUIRED" || undefined} />
                </label>
                <label className="field">Password
                  <input name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" disabled={v.status !== "USERNAME_PASSWORD_REQUIRED"} />
                </label>
                <Btn type="submit" className="primary" disabled={v.busy || v.status !== "USERNAME_PASSWORD_REQUIRED"}><span className="step-n" aria-hidden="true">2</span> Sign in</Btn>
              </form>
            </li>
            <li className="steps-list__item">
              <div className="steps-list__head"><span className="step-n" aria-hidden="true">3</span> Resume {v.status === "COMPLETED" || v.status === "SIGNED_IN" ? <Pill tone="ok">done</Pill> : null}</div>
              <div className="controls">
                <Btn type="button" className="primary" disabled={v.busy || v.status !== "RESUME_REQUIRED"} onClick={login.resume} data-autofocus={v.status === "RESUME_REQUIRED" || undefined}><span className="step-n" aria-hidden="true">3</span> Resume (GET /resume)</Btn>
              </div>
            </li>
            <li className="steps-list__item">
              <div className="steps-list__head"><span className="step-n" aria-hidden="true">4</span> Exchange the code {v.status === "SIGNED_IN" ? <Pill tone="ok">done</Pill> : null}</div>
              <div className="controls">
                <Btn type="button" className="primary" disabled={v.busy || v.status !== "COMPLETED"} onClick={login.exchange} data-autofocus={v.status === "COMPLETED" || undefined}><span className="step-n" aria-hidden="true">4</span> Exchange the code (POST /token)</Btn>
              </div>
            </li>
          </ol>

          {v.status === "DEVICE_SELECTION_REQUIRED" && v.flow?._embedded && (
            <form onSubmit={(e) => { e.preventDefault(); login.submit("device", { device: { id: device } }); }} className="form" aria-label="Choose a device">
              <fieldset className="field"><legend>Send the passcode to</legend>
                {v.flow._embedded.devices.map((d, i) => (
                  <label key={d.id} className="check"><input type="radio" name="device" value={d.id} checked={device === d.id} onChange={() => setDevice(d.id)} data-autofocus={i === 0 || undefined} /> <Inert text={`${d.type}: ${d.label}`} /></label>
                ))}
              </fieldset>
              <Btn type="submit" className="primary" disabled={v.busy}>Continue</Btn>
            </form>
          )}

          {v.status === "OTP_REQUIRED" && (
            <form onSubmit={(e) => { e.preventDefault(); login.submit("otp", { otp }); setOtp(""); }} className="form" aria-label="Verify the passcode">
              <label className="field">One-time passcode <span className="small">(mock: {mc.otp})</span>
                <input name="otp" value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" autoComplete="off" data-autofocus />
              </label>
              <Btn type="submit" className="primary" disabled={v.busy}>Verify</Btn>
            </form>
          )}

          {v.status === "SIGNED_IN" && <p className="verdict ok" data-testid="signed-in">Signed in. Tokens below.</p>}
          {v.status === "FAILED" && <p className="muted">This flow is over. Start over to open a new one.</p>}
          {v.status !== "IDLE" && <div className="actions"><button type="button" onClick={login.reset}>Start over</button></div>}
        </section>

        <TokenView result={v.result} nonceSent={v.result?.nonceSent} />
      </div>
      <aside aria-label="Trace pane" data-dev-only><TraceList entries={login.entries} title="Trace" /></aside>
    </div>
  );
}
