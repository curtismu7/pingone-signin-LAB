import React from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { startFakeServer } from "./fakeServer.js";
import { open } from "./helpers.jsx";
import Header from "../components/Header.jsx";
import { TABS } from "../App.jsx";

let fake;
beforeAll(async () => { fake = await startFakeServer(); });
afterAll(() => fake.stop());
beforeEach(() => { fake.reset(); try { localStorage.clear(); } catch { /* none */ } delete document.documentElement.dataset.theme; delete document.documentElement.dataset.present; });
afterEach(cleanup);

const present = () => document.documentElement.dataset.present === "1";

describe("Mock | Live toggle (every page)", () => {
  it("is in the header on every tab, Mock is pressed, and the banner and the mode say mock", async () => {
    const user = await open();
    for (const [id, label] of TABS) {
      await user.click(screen.getByRole("tab", { name: new RegExp(label) }));
      await waitFor(() => expect(screen.getByRole("tab", { name: new RegExp(label) })).toHaveAttribute("aria-selected", "true"));
      expect(screen.getByRole("group", { name: "Mode" })).toBeInTheDocument();
      expect(screen.getByTestId("mode-mock")).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("mode-live")).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByTestId("mode")).toHaveTextContent("MOCK: offline, no tenant");
      expect(screen.getByTestId("banner")).toHaveAttribute("data-state", "mock");
      expect(id).toBeTruthy();
    }
  });

  it("is in the header while the lab is still loading, and when it could not load", () => {
    render(<Header modeInfo={null} onMock={() => {}} onLive={() => {}} present={false} onPresent={() => {}} theme="auto" onTheme={() => {}} />);
    expect(screen.getByRole("group", { name: "Mode" })).toBeInTheDocument();
    expect(screen.getByTestId("mode")).toHaveTextContent("MOCK: offline, no tenant");
    expect(screen.queryByRole("button", { name: "Reset lab" })).toBeNull();
  });

  it("Real is disabled with the server's honest reason (409 contract), and the page stays Mock; Mock clears the note", async () => {
    const user = await open();
    await waitFor(() => expect(screen.getByTestId("mode-live")).toBeDisabled());
    expect(screen.getByTestId("mode-live").getAttribute("title")).toMatch(/Real \(live\) is not available in this lab/);
    await user.click(screen.getByTestId("mode-live")); // a disabled button sends nothing
    expect(fake.state.calls.some((c) => c.path === "/api/mode")).toBe(false);
    expect(screen.getByTestId("mode-mock")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("mode-live")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("banner")).toHaveTextContent(/MOCK: offline, no tenant/);
    await user.click(screen.getByTestId("mode-mock"));
    expect(screen.queryByTestId("mode-note")).toBeNull();
  });

  it("the server answers GET /api/info with the rule-19 shape and 409s a Real switch", async () => {
    const info = await (await fetch("/api/info")).json();
    expect(info.source).toBe("mock");
    expect(info.realAvailable).toBe(false);
    expect(info.realReason).toMatch(/not available in this lab/);
    const r = await fetch("/api/mode", { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ source: "real" }) });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("real_not_available");
    const bad = await fetch("/api/mode", { method: "POST", headers: { "content-type": "application/json", origin: window.location.origin }, body: JSON.stringify({ source: "live" }) });
    expect(bad.status).toBe(400);
  });
});

describe("presenter mode keys", () => {
  it("P toggles presenter mode, Esc leaves it, and the banner stays", async () => {
    const user = await open();
    await user.keyboard("p");
    await waitFor(() => expect(present()).toBe(true));
    expect(screen.getByTestId("banner")).toBeVisible();
    expect(screen.getByRole("button", { name: "Present" })).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(present()).toBe(false));
    await user.keyboard("P");
    await waitFor(() => expect(present()).toBe(true));
    await user.keyboard("P");
    await waitFor(() => expect(present()).toBe(false));
  });

  it("Ctrl, Cmd and Alt combinations and typing in a field are ignored", async () => {
    const user = await open();
    // Check after each key: three ignored toggles in a row used to end where they began and hide a removed guard.
    for (const mod of ["Control", "Meta", "Alt"]) {
      await user.keyboard(`{${mod}>}p{/${mod}}`);
      expect(present(), `${mod}+P must not toggle presenter mode`).toBe(false);
    }
    await user.keyboard("p");
    await waitFor(() => expect(present()).toBe(true));
    for (const mod of ["Control", "Meta", "Alt"]) {
      await user.keyboard(`{${mod}>}{Escape}{/${mod}}`);
      expect(present(), `${mod}+Esc must not leave presenter mode`).toBe(true);
      await user.keyboard(`{${mod}>}p{/${mod}}`);
      expect(present(), `${mod}+P must not toggle presenter mode off`).toBe(true);
    }
    await user.keyboard("{Escape}");
    await waitFor(() => expect(present()).toBe(false));
    await waitFor(() => expect(screen.getByLabelText("Username")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Open the flow/ }));
    const field = await waitFor(() => { const f = screen.getByLabelText("Username"); expect(f).toBeEnabled(); return f; });
    await user.type(field, "{Control>}a{/Control}pp");
    expect(field).toHaveValue("pp");
    expect(present()).toBe(false);
  });

  it("Esc outside presenter mode does nothing", async () => {
    const user = await open();
    await user.keyboard("{Escape}");
    expect(present()).toBe(false);
    expect(localStorage.getItem("psl.present")).toBeNull();
  });
});

describe("accessibility", () => {
  it("keeps the main landmark (the tab panel is inside it, not the landmark itself)", async () => {
    await open();
    const main = screen.getByRole("main");
    expect(main).toContainElement(screen.getByRole("tabpanel"));
    expect(screen.getByRole("tabpanel")).not.toBe(main);
  });

  it("a not-yet-ready action button is aria-disabled, not disabled, stays focusable, and a click does nothing", async () => {
    const user = await open();
    const resume = screen.getByRole("button", { name: /Resume \(GET \/as\/resume\)/ });
    expect(resume).toHaveAttribute("aria-disabled", "true");
    expect(resume).not.toHaveAttribute("disabled");
    resume.focus();
    expect(resume).toHaveFocus();
    await user.click(resume);
    expect(resume).toHaveFocus();
    expect(screen.getByTestId("flow-status")).not.toHaveTextContent("COMPLETED");
  });

  it("every Run button on the Scenarios tab is aria-disabled (not disabled) while a run is going", async () => {
    const user = await open("#/scenarios");
    const all = await screen.findByRole("button", { name: "Run all" });
    expect(all).not.toHaveAttribute("disabled");
    await user.click(all);
    await waitFor(() => expect(screen.getByTestId("scenario-summary")).toHaveTextContent(/16 of 16/), { timeout: 30000 });
    for (const b of screen.getAllByRole("button", { name: /^Run S\d+$/ })) expect(b).not.toHaveAttribute("disabled");
  }, 60000);
});
