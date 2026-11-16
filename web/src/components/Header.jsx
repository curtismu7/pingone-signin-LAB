import React from "react";
import ShelfLink from "./ShelfLink.jsx";
import VerifyMark from "./VerifyMark.jsx";
import ReturnLink from "../return-link/ReturnLink.jsx";
import { pageTraceparent } from "../lib/traceparent.js";
import TopMenu from "../top-menu/TopMenu.jsx";

// Shown when the server refuses Real (409), or as the Real button's tooltip while it is unavailable. The server's /api/info
// reason is the honest one; this is the fallback only if the server could not be asked.
export const LIVE_REFUSED = "Live mode is not available in this lab. It is an offline mock of a PingOne pi.flow sign-in, with no tenant connection and no credentials, so the page stays in Mock. For real PingOne shapes and live use, open pingone-LAB (owner-run, http://127.0.0.1:5500).";

// The shell bar on every page, including while the lab is still loading (STANDALONE-UI-PATTERNS.md section 1): brand + mode,
// the section pills, and the TopMenu. `catalog`, `onVertical` and `onReset` are absent until the lab has loaded. Rule 19: the
// toggle is server-side (POST /api/mode); Real is disabled with the server's reason while it is unavailable, so a disabled
// button sends nothing. The refusal text goes to `onNote`, which the page shows below the banner.
export default function Header({ catalog = null, onMock, onLive, modeInfo, present, onPresent, theme, onTheme, onVertical = null, onReset = null, talkActive = false, onTalk = null, onNote = () => {}, tabs = [], tab = null, onTab = () => {} }) {
  const customer = catalog?.customer || {};
  const realAvailable = modeInfo ? modeInfo.realAvailable !== false : null; // null = not known yet
  const pressLive = async () => {
    if (realAvailable === false) { onNote(modeInfo.realReason || LIVE_REFUSED); return; }
    const r = await onLive();
    if (r && !r.ok) onNote(r.data?.message || LIVE_REFUSED); else onNote("");
  };
  // The Raw section is hidden (not focusable) in presenter mode; arrow keys, Home and End move between the shown pills.
  const shown = present ? tabs.filter(([id]) => id !== "raw") : tabs;
  const onNavKey = (e) => {
    const i = shown.findIndex(([id]) => id === tab);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: shown.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const [id] = shown[(to + shown.length) % shown.length];
    onTab(id); document.getElementById(`tab-${id}`)?.focus();
  };
  return (
    <header className="shell-bar">
      <span className="shell-brand">
        <span className="shell-logo" aria-hidden="true">pi.flow</span>
        <h1>PingOne Sign-in LAB</h1>
        <span className="shell-badge" data-testid="mode">MOCK: offline, no tenant</span>
        {customer.name && <span className="shell-note" data-testid="customer-name">for {customer.name}</span>}
        {catalog && catalog.workspace !== "default" && <span className="shell-badge" data-testid="workspace">workspace {catalog.workspace}</span>}
      </span>
      <nav className="shell-nav" aria-label="Lab sections" onKeyDown={onNavKey}>
        {tabs.map(([id, label], i) => (
          <a key={id} id={`tab-${id}`} href={`#/${id}`} data-dev-only={id === "raw" ? "" : undefined} tabIndex={present && id === "raw" ? -1 : undefined} aria-current={id === tab ? "page" : undefined} onClick={(e) => { e.preventDefault(); onTab(id); }}>
            <span className="shell-nav__n" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span> {label}
          </a>
        ))}
      </nav>
      <TopMenu
        mode={{ value: modeInfo?.source === "real" ? "real" : "mock", onChange: (m) => (m === "real" ? pressLive() : onMock()), realAvailable: modeInfo ? modeInfo.realAvailable !== false : null, realHint: modeInfo?.realReason || LIVE_REFUSED }}
        vertical={catalog && onVertical ? { value: catalog.vertical, onChange: onVertical, options: catalog.verticals.map((v) => v.id) } : undefined}
        theme={{ value: theme, onChange: onTheme }}
        present={{ active: present, onToggle: onPresent, label: "Present" }}
        talkTrack={onTalk ? { active: talkActive, onToggle: onTalk } : undefined}
        help={{ href: "https://github.com/curtismu7/pingone-signin-LAB#readme" }}
        version={modeInfo?.version || null}
        onReset={onReset ? () => onReset() : undefined}
      >
        <ReturnLink app="pingone-signin" variant="header" />
        <ShelfLink traceparent={pageTraceparent} />
        <VerifyMark id="pingone-signin-lab" traceparent={pageTraceparent} />
      </TopMenu>
    </header>
  );
}
