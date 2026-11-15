import React from "react";
import { Inert } from "../lib/Inert.jsx";
import { decodeJwt } from "../lib/jwt.js";
import { rawMessage } from "../lib/trace.js";
import Json from "./JsonPane.jsx";

// A button that is "disabled" the accessible way: it stays focusable and says aria-disabled, and a click does nothing.
// (A native disabled button drops out of the tab order and loses focus the moment it is pressed.) Submit buttons are blocked too.
export function Btn({ disabled = false, onClick, type = "button", children, ...rest }) {
  return (
    <button type={type} aria-disabled={disabled ? "true" : undefined} onClick={(e) => { if (disabled) { e.preventDefault(); return; } if (onClick) onClick(e); }} {...rest}>
      {children}
    </button>
  );
}
export const Mock = ({ children = "mock" }) => <span className="badge badge--mock" title="Invented by this lab. Not a PingOne fact.">{children}</span>;
export const Unverified = () => <span className="badge badge--unv" title="Not checked against a real PingOne tenant.">UNVERIFIED</span>;
export const Pill = ({ tone = "hold", children, ...rest }) => <span className={`pill pill--${tone}`} {...rest}>{children}</span>;

// The right-hand pane: every request and response, in order. Text from the server is rendered inert.
export function TraceList({ entries, title = "Trace", empty = "Nothing sent yet. Each request and response will appear here." }) {
  return (
    <section className="trace" aria-label={title} data-dev-only>
      <h3>{title} <span className="muted small">({entries.length})</span></h3>
      {entries.length === 0 && <p className="muted">{empty}</p>}
      <ol className="trace__list">
        {entries.map((e, i) => { const m = rawMessage(e); return (
          <li key={e.n} className="trace__item">
            <details open={i === entries.length - 1}>
              <summary>
                <span className="trace__n">{e.n}</span>
                <span className="trace__title"><Inert text={e.title} /></span>
                <Pill tone={e.response.status >= 400 || e.response.status === 0 ? "deny" : "ok"} data-testid="trace-status">{e.response.status}</Pill>
              </summary>
              {e.note && <p className="small muted"><Inert text={e.note} /></p>}
              <h4>Request</h4>
              <Json value={m.request} label={`Request ${e.n}`} />
              <h4>Response</h4>
              <Json value={m.response} label={`Response ${e.n}`} />
            </details>
          </li>
        ); })}
      </ol>
    </section>
  );
}

// acr, amr, auth_time and nonce are what a resource server decides step-up on, so they stand out in the claims.
const HOT_CLAIMS = ["acr", "amr", "auth_time", "nonce"];

// Decoded tokens.
export function TokenView({ result, nonceSent }) {
  if (!result) return null;
  const { tokens, id, access } = result;
  const nonce = id?.payload?.nonce;
  return (
    <section className="card" aria-label="Tokens" data-testid="tokens">
      <h3>Tokens <Mock>mock tokens</Mock></h3>
      <p className="small muted">HS256, signed with a throwaway key that exists only in this server process, and marked <code>"mock": true</code>. The page decodes them, it does not verify them.</p>
      <h4>id_token claims</h4>
      {id ? <Json value={id.payload} label="id_token claims" testId="id-claims" hot={HOT_CLAIMS} /> : <p className="alert" role="alert">The id_token could not be decoded.</p>}
      {id && <p className="small muted">The highlighted claims are what a resource server decides step-up on. The acr names are this lab's own <Mock>mock acr name</Mock>.</p>}
      {id && nonceSent && nonce !== undefined && <p data-testid="nonce-check">nonce: <Pill tone={nonce === nonceSent ? "ok" : "deny"}>{nonce === nonceSent ? "matches the nonce we sent" : "DIFFERENT from the nonce we sent"}</Pill></p>}
      <details><summary>access_token claims</summary>{access ? <Json value={access.payload} label="access_token claims" testId="access-claims" hot={HOT_CLAIMS} /> : <p>Not a decodable JWT.</p>}</details>
      <details data-dev-only><summary>Raw tokens</summary>
        <h4>id_token</h4><Json value={tokens.id_token} label="id_token" testId="raw-id-token" />
        <h4>access_token</h4><Json value={tokens.access_token} label="access_token" testId="raw-access-token" />
      </details>
    </section>
  );
}
export { decodeJwt };
