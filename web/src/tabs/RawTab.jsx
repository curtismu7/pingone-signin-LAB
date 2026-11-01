import React from "react";
import { Inert } from "../lib/Inert.jsx";
import { rawMessage } from "../lib/trace.js";

// Every request and response the page has made, as HTTP text. Cookie values appear only in the server's shortened form.
export default function RawTab({ app }) {
  const groups = [["Sign in", app.login.entries], ["Step-up", app.stepup.entries], ["CIBA", app.ciba.entries], ["Last scenario run", Object.values(app.scenarios.results).slice(-1)[0]?.trace || []]];
  const total = groups.reduce((n, [, e]) => n + e.length, 0);
  return (
    <div>
      <h2>Raw HTTP</h2>
      <p className="lede">The messages as text, grouped by the tab that sent them. Passwords are masked and the session-token cookie is shortened, as in every trace here.</p>
      {total === 0 && <p className="muted">Nothing sent yet. Use another tab first.</p>}
      {groups.filter(([, e]) => e.length).map(([name, entries]) => (
        <section key={name} className="card" aria-label={name}>
          <h3>{name}</h3>
          {entries.map((e) => { const m = rawMessage(e); return (
            <div key={e.n}>
              <h4><Inert text={`${e.n}. ${e.title}`} /></h4>
              <Inert block text={m.request} testid="raw-request" />
              <Inert block text={m.response} testid="raw-response" />
            </div>
          ); })}
        </section>
      ))}
    </div>
  );
}
