import React, { useCallback, useEffect, useRef, useState } from "react";
import { getCatalog, getModeInfo, postMode, resetLab } from "./lib/api.js";
import Banner from "./components/Banner.jsx";
import Header from "./components/Header.jsx";
// Opened from Customer Agent LAB (UC-LOGIN and UC-LEARN16 route here): strip below the banner + header Back only; nothing is preselected.
import ReturnLink from "./return-link/ReturnLink.jsx";
import SignInTab, { useLogin } from "./tabs/SignInTab.jsx";
import StepUpTab, { useStepUp } from "./tabs/StepUpTab.jsx";
import CibaTab, { useCiba } from "./tabs/CibaTab.jsx";
import PasskeyTab, { usePasskey } from "./tabs/PasskeyTab.jsx";
import ScenariosTab, { useScenarios } from "./tabs/ScenariosTab.jsx";
import DiagramTab from "./tabs/DiagramTab.jsx";
import { loadFlows } from "./lib/diagram.js";
import RawTab from "./tabs/RawTab.jsx";
import TalkTrackTab from "./tabs/TalkTrackTab.jsx";
import { brandCss } from "./lib/brand.js";

export const TABS = [["signin", "Sign in"], ["stepup", "Step-up"], ["ciba", "CIBA"], ["passkey", "Passkey"], ["scenarios", "Scenarios"], ["diagram", "Diagram"], ["raw", "Raw"], ["talk", "Talk track"]];
const read = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } };
const tabFromHash = () => { const id = window.location.hash.replace(/^#\/?/, "").split("?")[0]; return TABS.some(([t]) => t === id) ? id : "signin"; };

export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [flows, setFlows] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState(tabFromHash);
  const [present, setPresent] = useState(() => read("psl.present", "0") === "1");
  const [theme, setTheme] = useState(() => (["light", "dark"].includes(read("psl.theme", "")) ? read("psl.theme", "") : "auto"));
  const [modeInfo, setModeInfo] = useState(null); // GET /api/info; null = not known yet
  useEffect(() => { getModeInfo().then((r) => setModeInfo(r.ok ? r.data : { realAvailable: false, realReason: null })).catch(() => {}); }, []);
  // Rule 19: the toggle is server-side. Mock is the only mode here, so switching is a POST that the server answers
  // (409 for Real, with the honest reason); the data is reloaded either way.
  const switchMode = useCallback(async (source) => {
    if (source === "mock") { return { ok: true, data: {} }; }
    const r = await postMode("real");
    setModeInfo(r.ok ? r.data : { realAvailable: false, ...(r.data || {}) });
    return r;
  }, []);

  useEffect(() => { Promise.all([getCatalog(), loadFlows()]).then(([c, f]) => { setFlows(f); setCatalog(c); }).catch((e) => setLoadError(e.message)); }, []);
  useEffect(() => { const on = () => setTab(tabFromHash()); window.addEventListener("hashchange", on); return () => window.removeEventListener("hashchange", on); }, []);
  useEffect(() => { if (present) document.documentElement.dataset.present = "1"; else delete document.documentElement.dataset.present; }, [present]);
  useEffect(() => { if (theme === "auto") { try { localStorage.removeItem("psl.theme"); } catch { /* not remembered */ } delete document.documentElement.dataset.theme; } else { write("psl.theme", theme); document.documentElement.dataset.theme = theme; } }, [theme]);

  const setPresentMode = useCallback((next) => {
    write("psl.present", next ? "1" : "0"); setPresent(next);
    if (next && tab === "raw") window.location.hash = "#/signin"; // the Raw tab is hidden in presenter mode
  }, [tab]);
  // P toggles presenter mode and Esc leaves it. Not while typing, and never with Ctrl, Cmd or Alt held (so the browser's own shortcuts are left alone).
  useEffect(() => {
    const on = (e) => {
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (e.key === "p" || e.key === "P") setPresentMode(!present);
      else if (e.key === "Escape" && present) setPresentMode(false);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [present, setPresentMode]);

  const setThemePersist = (v) => { setTheme(v); };
  const head = { modeInfo, onMock: () => switchMode("mock"), onLive: () => switchMode("real"), present, onPresent: () => setPresentMode(!present), theme, onTheme: setThemePersist };

  const shell = (body, header) => (
    <>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
      <Banner />
      <ReturnLink app="pingone-signin" />
      {header || <Header {...head} />}
      {body}
    </>
  );
  if (loadError) return shell(<main id="main" tabIndex={-1}><div className="page"><p className="alert" role="alert">Could not reach the lab server: {loadError}</p></div></main>);
  if (!catalog) return shell(<main id="main" tabIndex={-1}><div className="page"><p className="muted" role="status">Loading the mock…</p></div></main>);
  return <Shell catalog={catalog} flows={flows} setCatalog={setCatalog} tab={tab} theme={theme} present={present} head={head} />;
}

function Shell({ catalog, flows, setCatalog, tab, theme, present, head }) {
  const login = useLogin(catalog);
  const stepup = useStepUp(catalog);
  const ciba = useCiba(catalog);
  const passkey = usePasskey(catalog);
  const scenarios = useScenarios(catalog);
  const [cursor, setCursor] = useState(-1);
  const [boxes, setBoxes] = useState(flows.login.boxes);
  const [flowId, setFlowId] = useState("login");
  const [note, setNote] = useState("");
  const tabRefs = useRef({});
  const customer = catalog.customer || {};

  // customer.config: brand colours as CSS tokens (one <style>, no inline styles) and the customer's name in the title.
  useEffect(() => {
    let el = document.getElementById("customer-brand");
    if (!el) { el = document.createElement("style"); el.id = "customer-brand"; document.head.appendChild(el); }
    el.textContent = brandCss(customer.brand);
    document.title = customer.name ? `${customer.name}: PingOne Sign-in LAB (mock)` : "PingOne Sign-in LAB (mock)";
  }, [customer.brand, customer.name]);

  // Presenter mode: Right/Left (or PageDown/PageUp) step the diagram, unless the user is typing or on a control that uses the arrows.
  const steps = flows[flowId].steps.length;
  const stepBy = useCallback((d) => setCursor((c) => Math.min(steps - 1, Math.max(0, (c < 0 && d < 0 ? 0 : c) + d))), [steps]);
  useEffect(() => {
    if (!present || tab !== "diagram") return undefined;
    const on = (e) => {
      const t = e.target; const tag = t?.tagName;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag) || t?.getAttribute?.("role") === "tab" || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); stepBy(1); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); stepBy(-1); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [present, tab, stepBy]);

  const clearAll = useCallback(() => { login.reset(); stepup.reset(); ciba.reset(); passkey.reset(); scenarios.clear(); setCursor(-1); setBoxes(flows.login.boxes); }, [login, stepup, ciba, passkey, scenarios, flows]);
  const pickVertical = useCallback(async (id) => { const next = await getCatalog(id); setCatalog(next); clearAll(); }, [setCatalog, clearAll]);
  const resetServer = useCallback(async () => {
    try { await resetLab(); clearAll(); setNote("Lab reset: every flow, code, CIBA request and lockout is gone, and the token key is new."); }
    catch (e) { setNote(`Reset failed: ${e.message}`); }
  }, [clearAll]);

  const go = (id) => { window.location.hash = `#/${id}`; };
  const onTabKey = (e) => {
    const shown = present ? TABS.filter(([id]) => id !== "raw") : TABS; // the Raw tab is hidden (not focusable) in presenter mode
    const i = shown.findIndex(([id]) => id === shownTab);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: shown.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const [id] = shown[(to + shown.length) % shown.length];
    go(id); tabRefs.current[id]?.focus();
  };

  const app = { catalog, login, stepup, ciba, passkey, scenarios, cursor, setCursor, boxes, setBoxes, flows, flowId, setFlowId, theme, present, stepBy };
  const shownTab = present && tab === "raw" ? "signin" : tab; // the Raw tab is hidden in presenter mode
  const Panel = { signin: SignInTab, stepup: StepUpTab, ciba: CibaTab, passkey: PasskeyTab, scenarios: ScenariosTab, diagram: DiagramTab, raw: RawTab, talk: TalkTrackTab }[shownTab] || SignInTab;

  return (
    <>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
      <Banner />
      <ReturnLink app="pingone-signin" />
      <Header {...head} catalog={catalog} onVertical={pickVertical} onReset={resetServer} />
      <p className="muted small note" role="status" data-testid="reset-note">{note}</p>
      <div className="tabbar" role="tablist" aria-label="Lab sections" onKeyDown={onTabKey}>
        {TABS.map(([id, label], i) => (
          <button key={id} id={`tab-${id}`} data-dev-only={id === "raw" ? "" : undefined} ref={(el) => { tabRefs.current[id] = el; }} type="button" role="tab" aria-selected={id === shownTab} aria-controls="panel" tabIndex={id === shownTab ? 0 : -1} className="tab" onClick={() => go(id)}>
            <span className="tab__n" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span> {label}
          </button>
        ))}
      </div>
      <main id="main" tabIndex={-1}>
        <div className="page" id="panel" role="tabpanel" aria-labelledby={`tab-${shownTab}`}>
          <Panel key={catalog.vertical} app={app} />
        </div>
      </main>
    </>
  );
}
