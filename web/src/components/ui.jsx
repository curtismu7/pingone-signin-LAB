import React from "react";
import { Inert, pretty } from "../lib/Inert.jsx";
import { decodeJwt, when } from "../lib/jwt.js";

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
        {entries.map((e, i) => (
          <li key={e.n} className="trace__item">
            <details open={i === entries.length - 1}>
              <summary>
                <span className="trace__n">{e.n}</span>
                <span className="trace__title"><Inert text={e.title} /></span>
                <Pill tone={e.response.status >= 400 || e.response.status === 0 ? "deny" : "ok"} data-testid="trace-status">{e.response.status}</Pill>
              </summary>
              {e.note && <p className="small muted"><Inert text={e.note} /></p>}
              <h4>Request</h4>
              <Inert block text={`${e.request.method} ${e.request.url}\n${Object.entries(e.request.headers || {}).map(([k, v]) => `${k}: ${v}`).join("\n")}${e.request.body !== undefined ? `\n\n${e.request.body}` : ""}`} />
              <h4>Response</h4>
              <Inert block text={`${Object.entries(e.response.headers || {}).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => `${k}: ${x}`) : [`${k}: ${v}`])).join("\n")}${Object.keys(e.response.headers || {}).length ? "\n\n" : ""}${pretty(e.response.body)}`} />
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}

const HIGHLIGHT = new Set(["acr", "amr", "auth_time", "nonce"]);
function Claims({ payload, nonceSent, label }) {
  return (
    <table className="claims" aria-label={label}>
      <thead><tr><th scope="col">Claim</th><th scope="col">Value</th></tr></thead>
      <tbody>
        {Object.entries(payload).map(([k, v]) => (
          <tr key={k} className={HIGHLIGHT.has(k) ? "claim--hi" : ""}>
            <th scope="row">{k}</th>
            <td>
              <Inert text={typeof v === "object" ? JSON.stringify(v) : String(v)} />
              {k === "auth_time" && <span className="muted small"> ({when(v)})</span>}
              {k === "acr" && <Mock />}
              {k === "nonce" && nonceSent && <Pill tone={v === nonceSent ? "ok" : "deny"}>{v === nonceSent ? "matches the nonce we sent" : "DIFFERENT from the nonce we sent"}</Pill>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Decoded tokens. acr, amr, auth_time and nonce are marked: they are what a resource server decides step-up on.
export function TokenView({ result, nonceSent }) {
  if (!result) return null;
  const { tokens, id, access } = result;
  return (
    <section className="card" aria-label="Tokens" data-testid="tokens">
      <h3>Tokens <Mock>mock tokens</Mock></h3>
      <p className="small muted">HS256, signed with a throwaway key that exists only in this server process, and marked <code>"mock": true</code>. The page decodes them, it does not verify them.</p>
      <h4>id_token claims</h4>
      {id ? <Claims label="id_token claims" payload={id.payload} nonceSent={nonceSent} /> : <p className="alert" role="alert">The id_token could not be decoded.</p>}
      <details><summary>access_token claims</summary>{access ? <Claims label="access_token claims" payload={access.payload} /> : <p>Not a decodable JWT.</p>}</details>
      <details data-dev-only><summary>Raw tokens</summary>
        <h4>id_token</h4><Inert block text={tokens.id_token} testid="raw-id-token" />
        <h4>access_token</h4><Inert block text={tokens.access_token} testid="raw-access-token" />
      </details>
    </section>
  );
}
export { decodeJwt };
