import React, { useCallback, useMemo, useRef, useState } from "react";
import { createTracer } from "../lib/trace.js";
import { browserPasskeySupport, createSimulatedAuthenticator, credentialToJSON, decodeClientDataJSON, pageOrigin, toCreateOptions, toGetOptions } from "../lib/webauthn.js";
import { Inert, pretty } from "../lib/Inert.jsx";
import { Btn, Mock, Pill, TraceList, Unverified } from "../components/ui.jsx";

// The Passkey tab: a WebAuthn ceremony against this lab's own mock RP (/mock/passkey), registration then authentication,
// every value decoded and every server check shown. The authenticator is the browser's own (navigator.credentials) when the
// page can use it, otherwise a SIMULATED one in this page. PingOne's FIDO2 step (Real) is not run here: see the Real card.
const INIT = { regOpts: null, regCred: null, regResult: null, authOpts: null, authCred: null, authResult: null, replay: null, error: null, busy: false };
const JSON_POST = { method: "POST", headers: { "content-type": "application/json" } };

export function usePasskey(catalog) {
  const [entries, setEntries] = useState([]);
  const tracer = useMemo(() => createTracer(setEntries), []);
  const support = useMemo(() => browserPasskeySupport(), []);
  const [kind, setKind] = useState(support.ok ? "browser" : "simulated");
  const [username, setUsername] = useState(catalog.cast[0].username);
  const [s, setS] = useState(INIT);
  const sim = useRef(createSimulatedAuthenticator());
  const gen = useRef(0);
  const run = useCallback(async (fn) => {
    const g = gen.current;
    const put = (patch) => { if (g === gen.current) setS((x) => ({ ...x, ...(typeof patch === "function" ? patch(x) : patch) })); };
    put({ busy: true, error: null });
    try { await fn(put); } catch (e) { put({ error: `${e.name && e.name !== "Error" ? `${e.name}: ` : ""}${e.message || e}` }); } finally { put({ busy: false }); }
  }, []);
  const post = (title, path, body, note) => tracer.call(title, { ...JSON_POST, path, body: JSON.stringify(body), note });
  const answer = (r) => { if (r.status !== 200 && !(r.json && Array.isArray(r.json.steps))) throw new Error(r.json?.message || `HTTP ${r.status}`); return r.json; };
  const authenticate = async (op, pk) => {
    if (kind === "simulated") return op === "create" ? sim.current.create(pk, pageOrigin()) : sim.current.get(pk, pageOrigin());
    const cred = op === "create" ? await navigator.credentials.create({ publicKey: toCreateOptions(pk) }) : await navigator.credentials.get({ publicKey: toGetOptions(pk) });
    return credentialToJSON(cred);
  };

  const regOptions = () => run(async (put) => {
    tracer.clear(); put({ ...INIT, busy: true });
    put({ regOpts: answer(await post("Registration options", "/mock/passkey/register/options", { username }, "The RP makes a fresh challenge and names itself (rp.id) and the user (user.id, random bytes, not the username).")) });
  });
  const regCreate = () => run(async (put) => { put({ regCred: await authenticate("create", s.regOpts.publicKey) }); });
  const regVerify = () => run(async (put) => { put({ regResult: answer(await post("Verify the registration", "/mock/passkey/register/verify", s.regCred, "The RP checks the challenge, origin, RP ID hash and flags, then stores the public key.")) }); });
  const authOptions = () => run(async (put) => {
    put({ authOpts: answer(await post("Sign-in options", "/mock/passkey/login/options", { username }, "A new challenge, single use. allowCredentials lists this user's passkeys.")), authCred: null, authResult: null, replay: null });
  });
  const authGet = () => run(async (put) => { put({ authCred: await authenticate("get", s.authOpts.publicKey) }); });
  const authVerify = () => run(async (put) => { put({ authResult: answer(await post("Verify the assertion", "/mock/passkey/login/verify", s.authCred, "The RP checks the signature with the stored public key and that signCount went up.")) }); });
  const replay = () => run(async (put) => { put({ replay: answer(await post("Replay the same assertion", "/mock/passkey/login/verify", s.authCred, "An attacker resends a captured assertion. The challenge is already used and signCount did not go up.")) }); });
  const reset = useCallback(() => { gen.current += 1; tracer.clear(); sim.current.clear(); setS(INIT); }, [tracer]);
  const pickKind = (k) => { reset(); setKind(k); };
  const pickUser = (u) => { reset(); setUsername(u); };
  return { s, entries, support, kind, pickKind, username, pickUser, regOptions, regCreate, regVerify, authOptions, authGet, authVerify, replay, reset };
}

function Step({ n, title, state, children }) {
  return (
    <li className={`step step--${state}`}>
      <div className="step__head"><span className="step__n" aria-hidden="true">{n}</span><h3>{title}</h3> {state === "done" && <Pill tone="ok">done</Pill>}</div>
      {children}
    </li>
  );
}

const Kv = ({ rows, label }) => (
  <dl className="kv" aria-label={label}>
    {rows.filter(Boolean).map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd><Inert text={typeof v === "string" ? v : JSON.stringify(v)} /></dd></React.Fragment>)}
  </dl>
);

function ClientData({ cred, testid }) {
  const cd = decodeClientDataJSON(cred.response.clientDataJSON);
  return (
    <div data-testid={testid}>
      <h4>clientDataJSON, decoded</h4>
      {cd ? <Kv label="clientDataJSON" rows={Object.entries(cd)} /> : <p className="alert" role="alert">clientDataJSON is not JSON.</p>}
      <details data-dev-only><summary>Raw credential (base64url)</summary><Inert block text={pretty(cred)} /></details>
    </div>
  );
}

const FLAG_TEXT = { UP: "User Present", UV: "User Verified", BE: "Backup Eligible", BS: "Backed up (synced)", AT: "Attested credential data", ED: "Extensions" };
function AuthData({ a, before, testid }) {
  return (
    <div data-testid={testid}>
      <h4>authenticatorData, parsed by the RP</h4>
      <Kv label="authenticatorData" rows={[["rpIdHash", a.rpIdHash], ["signCount", before === undefined || before === null ? String(a.signCount) : `${a.signCount} (stored before: ${before})`], a.aaguid && ["aaguid", a.aaguid], a.credentialId && ["credential id", a.credentialId], a.publicKeyJwk && ["public key (JWK)", a.publicKeyJwk]]} />
      <p className="flags">{Object.entries(FLAG_TEXT).map(([k, label]) => <Pill key={k} tone={a.flags[k] ? "ok" : "hold"} data-testid={`flag-${k}`}>{k} {a.flags[k] ? "set" : "not set"}<span className="sr-only">: {label}</span></Pill>)}</p>
    </div>
  );
}

function Checks({ result, testid }) {
  return (
    <div data-testid={testid}>
      <h4>Server-side checks <Mock>mock RP</Mock></h4>
      <ol className="checks">
        {result.steps.map((x) => (
          <li key={x.id} data-check={x.id} data-ok={x.ok ? "1" : "0"}>
            <Pill tone={x.info ? "hold" : x.ok ? "ok" : "deny"}>{x.info ? "info" : x.ok ? "pass" : "fail"}</Pill> <Inert text={x.label} />
            <div className="small muted"><Inert text={x.detail || ""} /></div>
          </li>
        ))}
      </ol>
      {result.ok
        ? <p className="verdict ok" role="status">Verified{result.user ? `: ${result.user}` : ""}.</p>
        : <p className="alert" role="status">Refused: {result.steps.filter((x) => !x.ok).map((x) => x.id).join(", ")}.</p>}
    </div>
  );
}

export function RealPasskeyCard() {
  return (
    <section className="card" aria-label="Real: PingOne passkey" data-testid="passkey-real">
      <h3>Real: PingOne passkey (FIDO2) through pi.flow <Pill tone="hold">needs tenant setup</Pill></h3>
      <p>This lab has no Real mode (the header's Live is refused), so the PingOne FIDO2 step is <strong>not run here</strong>. With a tenant, the pi.flow sign-in reaches a FIDO2 step: the flow asks for an assertion and carries the WebAuthn request options, the page calls <code>navigator.credentials.get</code> (the same browser call as above) and posts the assertion back to the flow. The status name and body shape of that step are <Unverified /> in this lab (pingone-LAB, the owner-run live lab, names it <code>ASSERTION_REQUIRED</code> and also stops there: it has no passkey path either).</p>
      <h4>What the owner configures in the tenant first <Unverified /></h4>
      <p className="small muted">From the lab author's reading of PingOne's model, not checked against a tenant or a PingOne doc; console names may differ.</p>
      <ol className="small">
        <li><strong>FIDO policy</strong>: Relying Party ID = the domain the sign-in page is served on (see the trap below); attestation none; discoverable credentials (resident key) required for passkeys; user verification required or preferred; allow or refuse synced (backup eligible) passkeys.</li>
        <li><strong>MFA device authentication policy</strong>: FIDO2 enabled as a method and linked to that FIDO policy; allow enrollment during sign-in if users have no passkey yet.</li>
        <li><strong>Authentication (sign-on) policy</strong> on the application: an MFA step that uses that device authentication policy.</li>
        <li><strong>The application</strong>: the same pi.flow setup the password sign-in needs (response_mode pi.flow, PKCE), and the page origin in its allowed CORS origins if the browser calls PingOne directly.</li>
        <li><strong>A test user</strong> with MFA enabled and a FIDO2 device enrolled (or enrolled on first sign-in through the policy above), in an environment that has the MFA service.</li>
      </ol>
      <p className="alert" role="note" data-testid="rpid-trap"><strong>Trap: the RP ID must match the page's domain.</strong> A passkey is bound to the rp.id it was made for. A passkey made for another domain (another app, another tenant's FIDO policy, a different hostname) is refused by the browser and never offered; an IP address is never a valid RP ID. If the FIDO policy's RP ID is not the sign-in page's domain or a parent of it, the FIDO2 step fails.</p>
    </section>
  );
}

export default function PasskeyTab({ app }) {
  const { catalog, passkey: p } = app;
  const { s } = p;
  const reg = s.regResult; const auth = s.authResult;
  return (
    <div className="split">
      <div>
        <h2>Passkey (WebAuthn) <Mock>mock RP</Mock></h2>
        <p className="lede">A passkey is a key pair: the private key stays in the authenticator, the server (the relying party, RP) keeps the public key. Register one, then sign in with it, and watch what the RP checks. The RP here is this lab's own mock on this page's origin, not PingOne.</p>
        <section className="card" aria-label="Authenticator">
          <h3>Authenticator</h3>
          <div className="seg seg--wrap" role="group" aria-label="Authenticator">
            <button type="button" aria-pressed={p.kind === "browser"} aria-disabled={p.support.ok ? undefined : "true"} title={p.support.reason || undefined} onClick={() => { if (p.support.ok) p.pickKind("browser"); }} data-testid="auth-browser">This browser (navigator.credentials)</button>
            <button type="button" aria-pressed={p.kind === "simulated"} onClick={() => p.pickKind("simulated")} data-testid="auth-simulated">Simulated authenticator <Mock>mock</Mock></button>
          </div>
          {!p.support.ok && <p className="small muted" data-testid="browser-unavailable"><Inert text={p.support.reason} /></p>}
          {p.kind === "simulated" && <p className="small" data-testid="sim-note"><Mock>SIMULATED</Mock> Not a real passkey: a P-256 key pair made with WebCrypto in this page's memory (gone on reload). It reports UP and UV, and BE and BS as not set (device-bound).</p>}
          <label className="inline">User
            <select value={p.username} onChange={(e) => p.pickUser(e.target.value)} aria-label="User">
              {catalog.cast.map((c) => <option key={c.username} value={c.username}>{c.name} ({c.username})</option>)}
            </select>
          </label>
        </section>
        <ol className="steps">
          <Step n="1" title="Registration: get the options" state={s.regOpts ? "done" : "now"}>
            <Btn className="primary" disabled={s.busy} onClick={p.regOptions}>Get registration options</Btn>
            {s.regOpts && /^(\d{1,3}(\.\d{1,3}){3}|\[.*\])$/.test(s.regOpts.publicKey.rp.id) && <p className="small" data-testid="ip-rpid"><Mock>simulated only</Mock> This rp.id is an IP address: a real browser refuses it. Only the simulated authenticator can use it; open http://localhost:6171/ for a real passkey.</p>}
            {s.regOpts && <Kv label="registration options" rows={[["challenge", s.regOpts.publicKey.challenge], ["rp.id", s.regOpts.publicKey.rp.id], ["user.id", s.regOpts.publicKey.user.id], ["user.name", s.regOpts.publicKey.user.name], ["pubKeyCredParams", s.regOpts.publicKey.pubKeyCredParams], ["authenticatorSelection", s.regOpts.publicKey.authenticatorSelection], ["attestation", s.regOpts.publicKey.attestation], ["expected origin", s.regOpts.expectedOrigin]]} />}
          </Step>
          <Step n="2" title="Registration: the authenticator creates the passkey" state={s.regCred ? "done" : s.regOpts ? "now" : "wait"}>
            <Btn className="primary" disabled={!s.regOpts || s.busy || !!s.regCred} onClick={p.regCreate}>Create the passkey</Btn>
            {s.regCred && <ClientData cred={s.regCred} testid="reg-clientdata" />}
          </Step>
          <Step n="3" title="Registration: the RP verifies and stores the public key" state={reg?.ok ? "done" : s.regCred ? "now" : "wait"}>
            <Btn className="primary" disabled={!s.regCred || s.busy || !!reg} onClick={p.regVerify}>Verify the registration</Btn>
            {reg?.authData && <AuthData a={reg.authData} testid="reg-authdata" />}
            {reg && <p className="small">Attestation format: <code>{reg.fmt ?? "?"}</code></p>}
            {reg && <Checks result={reg} testid="reg-checks" />}
          </Step>
          <Step n="4" title="Sign in: get a fresh challenge" state={s.authOpts ? "done" : reg?.ok ? "now" : "wait"}>
            <Btn className="primary" disabled={!reg?.ok || s.busy} onClick={p.authOptions}>Get sign-in options</Btn>
            {s.authOpts && <Kv label="sign-in options" rows={[["challenge", s.authOpts.publicKey.challenge], ["rpId", s.authOpts.publicKey.rpId], ["allowCredentials", s.authOpts.publicKey.allowCredentials.map((c) => c.id)], ["userVerification", s.authOpts.publicKey.userVerification]]} />}
          </Step>
          <Step n="5" title="Sign in: the authenticator signs the challenge" state={s.authCred ? "done" : s.authOpts ? "now" : "wait"}>
            <Btn className="primary" disabled={!s.authOpts || s.busy || !!s.authCred} onClick={p.authGet}>Sign with the passkey</Btn>
            {s.authCred && <ClientData cred={s.authCred} testid="auth-clientdata" />}
            {s.authCred && <Kv label="assertion" rows={[["signature (DER, base64url)", s.authCred.response.signature], ["userHandle", s.authCred.response.userHandle ?? "(none)"]]} />}
          </Step>
          <Step n="6" title="Sign in: the RP verifies the signature" state={auth?.ok ? "done" : s.authCred ? "now" : "wait"}>
            <div className="actions">
              <Btn className="primary" disabled={!s.authCred || s.busy || !!auth} onClick={p.authVerify}>Verify the assertion</Btn>
              <Btn disabled={!auth?.ok || s.busy} onClick={p.replay}>Replay the same assertion</Btn>
            </div>
            {auth?.authData && <AuthData a={auth.authData} before={auth.signCountBefore} testid="auth-authdata" />}
            {auth && <Checks result={auth} testid="auth-checks" />}
            {s.replay && <><h4>Replay</h4><Checks result={s.replay} testid="replay-checks" /></>}
          </Step>
        </ol>
        {s.error && <p className="alert" role="alert" data-testid="passkey-error"><Inert text={s.error} /></p>}
        <div className="actions"><button type="button" onClick={p.reset}>Start over</button></div>
        <RealPasskeyCard />
      </div>
      <aside aria-label="Trace pane" data-dev-only><TraceList entries={p.entries} title="Trace" /></aside>
    </div>
  );
}
