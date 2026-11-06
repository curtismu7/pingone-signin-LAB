import React from "react";
import ShelfLink from "./ShelfLink.jsx";
import { pageTraceparent } from "../lib/traceparent.js";

// Shown when someone presses Live. This lab is an offline mock of a pi.flow sign-in: it has no live mode to switch to.
export const LIVE_REFUSED = "Live mode is not available in this lab. It is an offline mock of a PingOne pi.flow sign-in, with no tenant connection and no credentials, so the page stays in Mock. For real PingOne shapes and live use, open pingone-LAB (owner-run, http://127.0.0.1:5500).";

// The header on every page, including while the lab is still loading: the title, the Mock | Live toggle, the mode, and the controls.
// `catalog`, `onVertical` and `onReset` are absent until the lab has loaded.
export default function Header({ catalog = null, liveRefused, onMock, onLive, present, onPresent, theme, onTheme, onVertical = null, onReset = null }) {
  const customer = catalog?.customer || {};
  return (
    <>
      <header className="top">
        <h1>
          <span className="mark" aria-hidden="true">pi.flow</span> PingOne Sign-in LAB <span className="mode" data-testid="mode">MOCK: offline, no tenant</span>
          {customer.name && <span className="customer" data-testid="customer-name">for {customer.name}</span>}
          {catalog && catalog.workspace !== "default" && <span className="mode" data-testid="workspace">workspace {catalog.workspace}</span>}
        </h1>
        <div className="tools-right">
          <ShelfLink traceparent={pageTraceparent} />
          <div className="seg" role="group" aria-label="Mode">
            <button type="button" aria-pressed="true" onClick={onMock} data-testid="mode-mock">Mock</button>
            <button type="button" aria-pressed="false" onClick={onLive} data-testid="mode-live">Live</button>
          </div>
          {catalog && onVertical && (
            <label className="inline">Vertical
              <select value={catalog.vertical} onChange={(e) => onVertical(e.target.value)} aria-label="Vertical">
                {catalog.verticals.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
          )}
          {onReset && <button type="button" onClick={onReset}>Reset lab</button>}
          <button type="button" aria-pressed={present} onClick={onPresent} title="Presenter mode (P, Esc to leave): large text, no raw panes, arrow keys step the diagram">Present</button>
          <label className="inline">Theme
            <select value={theme} onChange={(e) => onTheme(e.target.value)} data-testid="theme">
              <option value="system">Auto</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
      </header>
      {liveRefused && <p className="mode-note" role="status" data-testid="mode-note">{LIVE_REFUSED}</p>}
    </>
  );
}
