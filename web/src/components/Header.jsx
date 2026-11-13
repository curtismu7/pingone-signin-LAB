import React, { useState } from "react";
import ShelfLink from "./ShelfLink.jsx";
import ReturnLink from "../return-link/ReturnLink.jsx";
import { pageTraceparent } from "../lib/traceparent.js";
import TopMenu from "../top-menu/TopMenu.jsx";

// Shown when the server refuses Real (409), or as the Real button's tooltip while it is unavailable. The server's /api/info
// reason is the honest one; this is the fallback only if the server could not be asked.
export const LIVE_REFUSED = "Live mode is not available in this lab. It is an offline mock of a PingOne pi.flow sign-in, with no tenant connection and no credentials, so the page stays in Mock. For real PingOne shapes and live use, open pingone-LAB (owner-run, http://127.0.0.1:5500).";

// The header on every page, including while the lab is still loading: the title, the Mock | Real toggle, the mode, and the controls.
// `catalog`, `onVertical` and `onReset` are absent until the lab has loaded. Rule 19: the toggle is server-side (POST /api/mode);
// Real is disabled with the server's reason while it is unavailable, so a disabled button sends nothing.
export default function Header({ catalog = null, onMock, onLive, modeInfo, present, onPresent, theme, onTheme, onVertical = null, onReset = null, talkActive = false, onTalk = null }) {
  const customer = catalog?.customer || {};
  const realAvailable = modeInfo ? modeInfo.realAvailable !== false : null; // null = not known yet
  const [note, setNote] = useState("");
  const pressLive = async () => {
    if (realAvailable === false) { setNote(modeInfo.realReason || LIVE_REFUSED); return; }
    const r = await onLive();
    if (r && !r.ok) setNote(r.data?.message || LIVE_REFUSED); else setNote("");
  };
  return (
    <>
      <header className="top">
        <h1>
          <span className="mark" aria-hidden="true">pi.flow</span> PingOne Sign-in LAB <span className="mode" data-testid="mode">MOCK: offline, no tenant</span>
          {customer.name && <span className="customer" data-testid="customer-name">for {customer.name}</span>}
          {catalog && catalog.workspace !== "default" && <span className="mode" data-testid="workspace">workspace {catalog.workspace}</span>}
        </h1>
        <div className="tools-right">
          <ReturnLink app="pingone-signin" variant="header" />
          <ShelfLink traceparent={pageTraceparent} />
          <TopMenu
            mode={{ value: modeInfo?.source === "real" ? "real" : "mock", onChange: (m) => (m === "real" ? pressLive() : onMock()), realAvailable: modeInfo ? modeInfo.realAvailable !== false : null, realHint: modeInfo?.realReason || LIVE_REFUSED }}
            vertical={catalog && onVertical ? { value: catalog.vertical, onChange: onVertical, options: catalog.verticals.map((v) => v.id) } : undefined}
            theme={{ value: theme, onChange: onTheme }}
            present={{ active: present, onToggle: onPresent, label: "Present" }}
            talkTrack={onTalk ? { active: talkActive, onToggle: onTalk } : undefined}
            help={{ href: "https://github.com/curtismu7/pingone-signin-LAB#readme" }}
            version={modeInfo?.version || null}
            onReset={onReset ? () => onReset() : undefined}
          />
        </div>
      </header>
      {note && <p className="mode-note" role="status" data-testid="mode-note">{note}</p>}
    </>
  );
}
