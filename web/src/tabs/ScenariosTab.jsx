import React, { useCallback, useRef, useState } from "react";
import { runAll, runScenario } from "../lib/api.js";
import { Inert } from "../lib/Inert.jsx";
import { Pill, TraceList, Btn } from "../components/ui.jsx";

export function useScenarios(catalog) {
  const [results, setResults] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);
  const gen = useRef(0); // bumped by clear(): results of runs started before it are dropped
  const guard = useCallback(async (id, fn) => {
    const g = gen.current;
    setBusy(id); setError(null);
    try { await fn(g); } catch (e) { if (g === gen.current) setError(String(e.message || e)); } finally { if (g === gen.current) setBusy(null); }
  }, []);
  const run = useCallback((id) => guard(id, async (g) => { const r = await runScenario(id, catalog.vertical); if (g !== gen.current) return; setResults((x) => ({ ...x, [r.id]: r })); setSummary(null); }), [guard, catalog.vertical]);
  const all = useCallback(() => guard("all", async (g) => {
    const r = await runAll(catalog.vertical);
    if (g !== gen.current) return;
    setResults(Object.fromEntries(r.results.map((x) => [x.id, x])));
    setSummary({ passed: r.passed, total: r.total, vertical: r.vertical });
  }), [guard, catalog.vertical]);
  const clear = useCallback(() => { gen.current += 1; setBusy(null); setResults({}); setSummary(null); setError(null); }, []);
  return { results, busy, error, summary, run, all, clear };
}

function Compare({ expected, actual }) {
  return (
    <table className="claims" aria-label="Expected versus actual">
      <thead><tr><th scope="col">Field</th><th scope="col">Expected</th><th scope="col">Actual</th><th scope="col">Match</th></tr></thead>
      <tbody>
        {Object.entries(expected).map(([k, v]) => {
          const ok = actual?.[k] === v;
          return <tr key={k}><th scope="row">{k}</th><td><Inert text={JSON.stringify(v)} /></td><td><Inert text={JSON.stringify(actual?.[k])} /></td><td><Pill tone={ok ? "ok" : "deny"}>{ok ? "match" : "DIFFERENT"}</Pill></td></tr>;
        })}
      </tbody>
    </table>
  );
}

export default function ScenariosTab({ app }) {
  const { catalog, scenarios: sc } = app;
  return (
    <div>
      <h2>Scenarios</h2>
      <p className="lede">{catalog.scenarios.length} scripted stories, each run by the server against a fresh in-process mock and a fake clock, then compared with what the data file says should happen. Vertical: <strong>{catalog.verticals.find((v) => v.id === catalog.vertical)?.name}</strong> (change it in the header).</p>
      <div className="actions">
        <Btn type="button" className="primary" disabled={!!sc.busy} onClick={sc.all}>Run all</Btn>
        <button type="button" onClick={sc.clear}>Clear results</button>
      </div>
      <p className="status" role="status" aria-live="polite" data-testid="scenario-summary">
        {sc.busy ? "Running…" : sc.summary ? `${sc.summary.passed} of ${sc.summary.total} behaved as written.` : ""}
      </p>
      {sc.error && <p className="alert" role="alert"><Inert text={sc.error} /></p>}
      <ul className="scenarios">
        {catalog.scenarios.map((s) => {
          const r = sc.results[s.id];
          return (
            <li key={s.id} className="card scenario" data-testid={`scenario-${s.id}`}>
              <div className="scenario__head">
                <span className="mono">{s.id}</span>
                <h3><Inert text={s.title} /></h3>
                <Pill tone={s.kind === "pass" ? "ok" : "hold"}>{s.kind === "pass" ? "should succeed" : "should be refused"}</Pill>
                {r && <Pill tone={r.pass ? "ok" : "deny"} data-testid={`result-${s.id}`}>{r.pass ? "PASS" : "FAIL"}</Pill>}
              </div>
              <p className="muted"><Inert text={s.takeaway} /></p>
              <Btn type="button" disabled={!!sc.busy} onClick={() => sc.run(s.id)} aria-label={`Run ${s.id}`}>Run</Btn>
              {r && (
                <div className="scenario__out">
                  <Compare expected={r.expected} actual={r.actual} />
                  {r.error && <p className="alert" role="alert"><Inert text={r.error} /></p>}
                  <details><summary>Trace ({r.trace.length} calls)</summary><TraceList entries={r.trace} title={`Trace ${r.id}`} /></details>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
