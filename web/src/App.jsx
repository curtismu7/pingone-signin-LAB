import React, { useCallback, useEffect, useState } from "react";
import { getCatalog, getModeInfo, postMode, resetLab } from "./lib/api.js";
import Banner from "./components/Banner.jsx";
import Header from "./components/Header.jsx";
import TalkTrackDialog from "./talk-track/TalkTrackDialog.jsx";
import talkMd from "../../docs/talk-track.md?raw";
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
const talkStepsOf = () => {
  const steps = []; let n = 0;
  for (const line of talkMd.split("\n")) {
    const m = line.match(/^\d+\.\s+(?:"(.+?)"|\*\*(.+?)\.\*\*\s*(.*))$/);
    if (m) { n += 1; steps.push({ id: `s${n}`, title: (m[1] || m[2]).slice(0, 60), say: m[1] || m[3] }); }
  }
  return steps.length ? steps : [{ id: "s1", title: "Talk track", say: talkMd.slice(0, 600) }];
};
const read = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } };
const tabFromHash = () => { const id = window.location.hash.replace(/^#\/?/, "").split("?")[0]; return TABS.some(([t]) => t === id) ? id : "signin"; };

export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [talkOpen, setTalkOpen] = useState(false);
  const [flows, setFlows] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState(tabFromHash);
  const [present, setPresent] = useState(() => read("psl.present", "0") === "1");
  const [theme, setTheme] = useState(() => (["light", "dark"].includes(read("psl.theme", "")) ? read("psl.theme", "") : "auto"));
  const [modeInfo, setModeInfo] = useState(null); // GET /api/info; null = not known yet
  const [modeNote, setModeNote] = useState(""); // the Real refusal, shown below the banner
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
  const shownTab = present && tab === "raw" ? "signin" : tab; // the Raw tab is hidden in presenter mode

  const head = { modeInfo, onMock: () => switchMode("mock"), onLive: () => switchMode("real"), onNote: setModeNote, present, onPresent: () => setPresentMode(!present), theme, onTheme: setThemePersist, talkActive: talkOpen, onTalk: () => setTalkOpen((v) => !v), tabs: TABS, tab: shownTab, onTab: (id) => { window.location.hash = `#/${id}`; } };

  if (loadError) return <Frame head={head} modeNote={modeNote}><p className="alert" role="alert">Could not reach the lab server: {loadError}</p></Frame>;
  if (!catalog) return <Frame head={head} modeNote={modeNote}><p className="muted" role="status">Loading the mock…</p></Frame>;
  return <Shell catalog={catalog} flows={flows} setCatalog={setCatalog} tab={tab} shownTab={shownTab} theme={theme} present={present} head={head} modeNote={modeNote} />;
}

// The page frame for every state (STANDALONE-UI-PATTERNS.md sections 1-3): the shell bar first, then <main> in the centred
// 1100px column, whose first child is the simulation banner; the hand-off strip and the Real refusal sit right below it.
function Frame({ head, modeNote, children }) {
  return (
    <>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
      <Header {...head} />
      <main id="main" className="page" tabIndex={-1}>
        <Banner />
        <ReturnLink app="pingone-signin" />
        {modeNote && <p className="mode-note" role="status" data-testid="mode-note">{modeNote}</p>}
        {children}
      </main>
    </>
  );
}

function Shell({ catalog, flows, setCatalog, tab, shownTab, theme, present, head, modeNote }) {
  const login = useLogin(catalog);
  const stepup = useStepUp(catalog);
  const ciba = useCiba(catalog);
  const passkey = usePasskey(catalog);
  const scenarios = useScenarios(catalog);
  const [cursor, setCursor] = useState(-1);
  const [boxes, setBoxes] = useState(flows.login.boxes);
  const [flowId, setFlowId] = useState("login");
  const [note, setNote] = useState("");
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
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag) || t?.closest?.(".shell-nav") || e.altKey || e.ctrlKey || e.metaKey) return;
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

  const app = { catalog, login, stepup, ciba, passkey, scenarios, cursor, setCursor, boxes, setBoxes, flows, flowId, setFlowId, theme, present, stepBy };
  const Panel = { signin: SignInTab, stepup: StepUpTab, ciba: CibaTab, passkey: PasskeyTab, scenarios: ScenariosTab, diagram: DiagramTab, raw: RawTab, talk: TalkTrackTab }[shownTab] || SignInTab;

  return (
    <Frame head={{ ...head, catalog, onVertical: pickVertical, onReset: resetServer }} modeNote={modeNote}>
      <p className="muted small note" role="status" data-testid="reset-note">{note}</p>
      <section id="panel" aria-labelledby={`tab-${shownTab}`}>
        <Panel key={catalog.vertical} app={app} />
      </section>
      <TalkTrackDialog isOpen={head.talkActive} onClose={() => head.onTalk()} talk={talkStepsOf()} />
    </Frame>
  );
}

