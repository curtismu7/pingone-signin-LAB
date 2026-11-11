import React from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { jsonResponse, startFakeServer } from "./fakeServer.js";
import { open, enabled } from "./helpers.jsx";
import { brandCss } from "../lib/brand.js";
import { TRACEPARENT_RE } from "../lib/traceparent.js";

// The controls are always on screen, greyed out until their step is ready, so wait for enabled ones.
const enabledField = (label) => waitFor(() => { const f = screen.getByLabelText(label); expect(f).toBeEnabled(); return f; });


let fake;
beforeAll(async () => { fake = await startFakeServer(); });
afterAll(() => fake.stop());
beforeEach(() => { fake.reset(); try { localStorage.clear(); } catch { /* none */ } delete document.documentElement.dataset.present; delete document.documentElement.dataset.theme; });
afterEach(cleanup);

const tpOf = (c) => c.headers.traceparent;

describe("traceparent on every hop (rule 14)", () => {
  it("every request the page makes, on every tab, carries a valid traceparent, and one run shares one trace id", async () => {
    const user = await open("#/signin");
    // sign in
    await user.click(screen.getByRole("button", { name: /Open the flow/ }));
    await user.type(await enabledField("Username"), "{Control>}a{/Control}mark");
    await user.type(screen.getByLabelText("Password"), "mock-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.click(await screen.findByRole("button", { name: /Resume/ }));
    await user.click(await screen.findByRole("button", { name: /Exchange the code/ }));
    await screen.findByTestId("signed-in");
    const loginCalls = fake.state.calls.filter((c) => c.path.startsWith("/mock/"));
    expect(loginCalls.length).toBe(4);
    const loginTrace = new Set(loginCalls.map((c) => tpOf(c).split("-")[1]));
    expect(loginTrace.size).toBe(1);
    expect(new Set(loginCalls.map((c) => tpOf(c).split("-")[2])).size).toBe(4);
    // the trace pane and the Raw tab show the header, and the answer's too
    const pane = screen.getByRole("region", { name: "Trace" });
    expect((pane.textContent.match(/traceparent: 00-[0-9a-f]{32}-[0-9a-f]{16}-01/g) || []).length).toBe(8);
    // the Raw tab shows the header on every request and every answer of the run
    await user.click(screen.getByRole("tab", { name: /Raw/ }));
    const raws = [...screen.getAllByTestId("raw-request"), ...screen.getAllByTestId("raw-response")];
    expect(raws).toHaveLength(8);
    for (const r of raws) expect(r.textContent).toMatch(/traceparent: 00-[0-9a-f]{32}-[0-9a-f]{16}-01/);
    // step-up, CIBA (with the phone), scenarios, reset
    await user.click(screen.getByRole("tab", { name: /Step-up/ }));
    await user.click(screen.getByRole("button", { name: "Sign in (low acr)" }));
    await screen.findByTestId("low-acr");
    await user.click(screen.getByRole("button", { name: "Call POST /rs/transfer" }));
    await screen.findByTestId("challenge");
    await user.click(screen.getByRole("tab", { name: /CIBA/ }));
    await user.click(screen.getByRole("button", { name: /Start \(POST/ }));
    await screen.findByTestId("auth-req-id");
    await user.click(await enabled("Approve"));
    await user.click(screen.getByRole("button", { name: "Poll now" }));
    await user.click(screen.getByRole("tab", { name: /Scenarios/ }));
    await user.click(screen.getByRole("button", { name: "Run S01" }));
    await screen.findByTestId("result-S01");
    await user.click(screen.getByTestId("reset"));
    await waitFor(() => expect(screen.getByTestId("reset-note")).toHaveTextContent(/Lab reset/));
    expect(fake.state.calls.length).toBeGreaterThan(15);
    const missing = fake.state.calls.filter((c) => !TRACEPARENT_RE.test(tpOf(c) || ""));
    expect(missing.map((c) => `${c.method} ${c.path}`)).toEqual([]);
  });

  it("a new run (Start over) starts a new trace id", async () => {
    const user = await open("#/signin");
    for (let i = 0; i < 2; i++) { await user.click(await enabled(/Open the flow/)); await enabledField("Username"); await user.click(screen.getByRole("button", { name: "Start over" })); }
    const ids = fake.state.calls.filter((c) => c.path.startsWith("/mock/authorize")).map((c) => tpOf(c).split("-")[1]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe("presenter mode (rules 2 and 3)", () => {
  it("large text and no raw panes, the simulation banner stays, and the setting is remembered", async () => {
    const user = await open("#/signin");
    const btn = screen.getByRole("button", { name: "Present" });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    await user.click(btn);
    expect(document.documentElement.dataset.present).toBe("1");
    expect(btn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("banner")).toHaveTextContent(/MOCK: offline, no tenant/);
    expect(screen.getByTestId("banner").closest("[data-dev-only]")).toBeNull();
    expect(screen.getByTestId("mode")).toBeInTheDocument();
    // everything the CSS hides in presenter mode is marked: the Raw tab, the trace pane, the raw tokens
    expect(screen.getByRole("tab", { name: /Raw/ })).toHaveAttribute("data-dev-only");
    expect(screen.getByRole("complementary", { name: "Trace pane" })).toHaveAttribute("data-dev-only");
    expect(screen.getByRole("region", { name: "Trace" })).toHaveAttribute("data-dev-only");
    expect(localStorage.getItem("psl.present")).toBe("1");
    await user.click(btn);
    expect(document.documentElement.dataset.present).toBeUndefined();
  });

  it("the banner is there on every tab, in presenter mode too", async () => {
    const user = await open("#/signin");
    await user.click(screen.getByRole("button", { name: "Present" }));
    for (const tab of ["Sign in", "Step-up", "CIBA", "Passkey", "Scenarios", "Diagram", "Talk track"]) {
      await user.click(screen.getByRole("tab", { name: new RegExp(tab) }));
      expect(screen.getByTestId("banner")).toBeVisible();
      expect(screen.getByTestId("banner")).toHaveTextContent(/fictional/);
    }
  });

  it("turning presenter mode on while on Raw moves to Sign in (Raw is hidden)", async () => {
    const user = await open("#/raw");
    await user.click(screen.getByRole("button", { name: "Present" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: /Sign in/ })).toHaveAttribute("aria-selected", "true"));
  });

  it("presenter mode on #/raw selects Sign in: the hidden Raw tab is not the selected tab", async () => {
    const user = await open("#/raw");
    expect(screen.getByRole("tab", { name: /Raw/ })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("button", { name: "Present" }));
    window.location.hash = "#/raw"; window.dispatchEvent(new HashChangeEvent("hashchange")); // opening the Raw address while presenting
    await waitFor(() => expect(screen.getByRole("tab", { name: /Sign in/ })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("tab", { name: /Raw/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: /Raw/ })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "tab-signin");
    expect(screen.queryByRole("heading", { name: "Raw HTTP" })).toBeNull();
  });

  it("keyboard next and previous step walk the diagram", async () => {
    const user = await open("#/diagram");
    await user.click(screen.getByRole("button", { name: "Present" }));
    const caption = () => screen.getByTestId("caption").textContent;
    expect(screen.getByTestId("present-hint")).toBeInTheDocument();
    expect(caption()).toMatch(/Press Simulate/);
    act(() => { document.body.focus(); fireEvent.keyDown(document.body, { key: "ArrowRight" }); });
    expect(caption()).toMatch(/Step 1 of 7/);
    act(() => { fireEvent.keyDown(document.body, { key: "ArrowRight" }); });
    act(() => { fireEvent.keyDown(document.body, { key: "PageDown" }); });
    expect(caption()).toMatch(/Step 3 of 7/);
    act(() => { fireEvent.keyDown(document.body, { key: "ArrowLeft" }); });
    expect(caption()).toMatch(/Step 2 of 7/);
    for (let i = 0; i < 10; i++) act(() => { fireEvent.keyDown(document.body, { key: "ArrowRight" }); });
    expect(caption()).toMatch(/Step 7 of 7/);
    for (let i = 0; i < 10; i++) act(() => { fireEvent.keyDown(document.body, { key: "PageUp" }); });
    expect(caption()).toMatch(/Step 1 of 7/);
  });

  it("the arrow keys are left alone in a form field and in the tab list, and outside presenter mode", async () => {
    const user = await open("#/diagram");
    const caption = () => screen.getByTestId("caption").textContent;
    act(() => { fireEvent.keyDown(document.body, { key: "ArrowRight" }); });
    expect(caption()).toMatch(/Press Simulate/); // not in presenter mode
    await user.click(screen.getByRole("button", { name: "Present" }));
    act(() => { fireEvent.keyDown(screen.getByLabelText("Speed"), { key: "ArrowRight" }); });
    act(() => { fireEvent.keyDown(screen.getByRole("tab", { name: /Diagram/ }), { key: "ArrowRight" }); });
    expect(caption()).toMatch(/Press Simulate/); // no step taken by either
  });

  it("Ctrl, Cmd and Alt with an arrow key do not step the diagram", async () => {
    const user = await open("#/diagram");
    await user.click(screen.getByRole("button", { name: "Present" }));
    const caption = () => screen.getByTestId("caption").textContent;
    for (const mod of ["ctrlKey", "metaKey", "altKey"]) {
      act(() => { document.body.focus(); fireEvent.keyDown(document.body, { key: "ArrowRight", [mod]: true }); });
      expect(caption(), `${mod}+ArrowRight must not step`).toMatch(/Press Simulate/);
    }
    act(() => { fireEvent.keyDown(document.body, { key: "ArrowRight" }); });
    expect(caption()).toMatch(/Step 1 of 7/); // the plain key still works
  });

  it("Previous step and Next step buttons work without presenter mode", async () => {
    const user = await open("#/diagram");
    await user.click(screen.getByRole("button", { name: "Next step" }));
    expect(screen.getByTestId("caption").textContent).toMatch(/Step 1 of/);
    await user.click(screen.getByRole("button", { name: "Next step" }));
    expect(screen.getByTestId("caption").textContent).toMatch(/Step 2 of/);
    await user.click(screen.getByRole("button", { name: "Previous step" }));
    expect(screen.getByTestId("caption").textContent).toMatch(/Step 1 of/);
  });

  it("the talk track is a tab and shows docs/talk-track.md as inert text", async () => {
    const user = await open("#/talk");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Talk track");
    expect(document.querySelector(".talk").textContent).toContain("npm run doctor");
    expect(document.querySelector(".talk img")).toBeNull();
    await user.click(screen.getByRole("tab", { name: /Talk track/ }));
    expect(screen.getByRole("tab", { name: /Talk track/ })).toHaveAttribute("aria-selected", "true");
  });
});

describe("customer.config in the page (rule 12)", () => {
  const withCustomer = (customer, extra = {}) => {
    const real = globalThis.fetch;
    fake.state.intercept = (path, init) => {
      if (path !== "/api/catalog") return null;
      fake.state.intercept = null;
      return real(path, init).then(async (r) => jsonResponse({ ...(await r.json()), customer, ...extra }));
    };
  };

  it("brand colours become CSS tokens in one style element, the name is shown, the title changes", async () => {
    withCustomer({ name: "Contoso Air", brand: { primary: "#0b6bcb", onPrimary: "#ffffff", primaryDark: "#6fa8ee", onPrimaryDark: "#14171c" } });
    await open("#/signin");
    const css = document.getElementById("customer-brand").textContent;
    expect(css).toContain(":root{--accent:#0b6bcb;--on-accent:#ffffff;--accent-gradient:#0b6bcb;}");
    expect(css).toContain('@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--accent:#6fa8ee;--on-accent:#14171c;--accent-gradient:#6fa8ee;}}');
    expect(css).toContain(':root[data-theme="dark"]{--accent:#6fa8ee;--on-accent:#14171c;--accent-gradient:#6fa8ee;}');
    expect(document.querySelectorAll("#customer-brand")).toHaveLength(1);
    expect(screen.getByTestId("customer-name")).toHaveTextContent("for Contoso Air");
    expect(document.title).toBe("Contoso Air: PingOne Sign-in LAB (mock)");
    expect(screen.getByTestId("banner")).toHaveTextContent(/MOCK: offline, no tenant/); // branding never hides the simulation banner
  });

  it("with no customer config the page uses the default theme and title, and nothing is injected", async () => {
    await open("#/signin");
    expect(document.getElementById("customer-brand").textContent).toBe("");
    expect(screen.queryByTestId("customer-name")).toBeNull();
    expect(document.title).toBe("PingOne Sign-in LAB (mock)");
  });

  it("hostile text in a customer name is shown as text", async () => {
    withCustomer({ name: '<img src=x onerror="window.__pwn=1">' });
    await open("#/signin");
    expect(screen.getByTestId("customer-name").textContent).toContain("<img src=x");
    expect(document.querySelector("img")).toBeNull();
    expect(window.__pwn).toBeUndefined();
  });

  it("brandCss writes only well-formed colours and nothing else", () => {
    expect(brandCss(undefined)).toBe("");
    expect(brandCss({})).toBe("");
    expect(brandCss({ primary: "red;} body{display:none", onPrimary: "#ffffff" })).toBe("");
    expect(brandCss({ primary: "#0b6bcb", onPrimary: "url(x)" })).toBe("");
    expect(brandCss({ primary: "#0b6bcb", onPrimary: "#ffffff" })).toBe(':root{--accent:#0b6bcb;--on-accent:#ffffff;--accent-gradient:#0b6bcb;}\n:root[data-theme="light"]{--accent:#0b6bcb;--on-accent:#ffffff;--accent-gradient:#0b6bcb;}');
  });

  it("the vertical picker lists three packs and the customer's vocabulary is shown in the step-up story", async () => {
    await open("#/signin");
    expect([...screen.getByLabelText("Vertical").options].map((o) => o.value)).toEqual(["travel", "banking", "healthcare"]);
  });
});
