import React from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { startFakeServer } from "./fakeServer.js";
import { open, enabled } from "./helpers.jsx";

// The controls are always on screen, greyed out until their step is ready, so wait for enabled ones.
const enabledField = (label) => waitFor(() => { const f = screen.getByLabelText(label); expect(f).toBeEnabled(); return f; });


let fake;
beforeAll(async () => { fake = await startFakeServer(); });
afterAll(() => fake.stop());
beforeEach(() => { fake.reset(); try { localStorage.clear(); } catch { /* none */ } delete document.documentElement.dataset.theme; });
afterEach(cleanup);

describe("shell", () => {
  it("says MOCK: offline, no tenant, and has the seven tabs", async () => {
    await open();
    expect(screen.getByTestId("banner")).toHaveTextContent(/MOCK: offline, no tenant/);
    expect(screen.getByTestId("mode")).toHaveTextContent("MOCK: offline, no tenant");
    expect(within(screen.getByRole("navigation", { name: "Lab sections" })).getAllByRole("link").map((t) => t.textContent.replace(/^\d+\s*/, ""))).toEqual(["Sign in", "Step-up", "CIBA", "Passkey", "Scenarios", "Diagram", "Raw", "Talk track"]);
    expect(screen.getByRole("link", { name: /Sign in/ })).toHaveAttribute("aria-current", "page");
  });

  it("shell bar first (brand, mode, section pills, TopMenu), then main with the banner as its first child", async () => {
    await open();
    const bar = document.querySelector("header.shell-bar");
    expect(bar).not.toBeNull();
    expect(bar.querySelector(".shell-brand h1")).toHaveTextContent("PingOne Sign-in LAB");
    expect(bar.querySelector(".shell-brand [data-testid=mode]")).toHaveTextContent("MOCK: offline, no tenant");
    expect(bar.querySelector('.shell-nav a[aria-current="page"]')).toHaveTextContent("Sign in");
    expect(bar.querySelector("[data-testid=top-menu]")).toHaveClass("shell-right");
    const main = screen.getByRole("main");
    expect(bar.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(main.firstElementChild).toBe(screen.getByTestId("banner"));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("arrow keys move between tabs", async () => {
    const user = await open();
    screen.getByRole("link", { name: /Sign in/ }).focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(screen.getByRole("link", { name: /Step-up/ })).toHaveAttribute("aria-current", "page"));
    expect(screen.getByRole("link", { name: /Step-up/ })).toHaveFocus();
  });

  it("theme select sets data-theme", async () => {
    const user = await open();
    await user.selectOptions(screen.getByTestId("theme-select"), "light");
    expect(document.documentElement.dataset.theme).toBe("light");
    await user.selectOptions(screen.getByTestId("theme-select"), "dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    await user.selectOptions(screen.getByTestId("theme-select"), "auto");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem("psl.theme")).toBeNull();
  });

  it("only ever calls its own origin paths under /api and /mock", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: /Open the flow/ }));
    await enabledField("Username");
    expect(fake.state.calls.length).toBeGreaterThan(1);
    expect(fake.state.calls.every((c) => /^\/(api|mock)\//.test(c.path))).toBe(true);
  });

  it("Reset lab calls POST /api/reset and clears the flow on screen", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: /Open the flow/ }));
    await enabledField("Username");
    await user.click(screen.getByTestId("reset"));
    await waitFor(() => expect(screen.getByTestId("reset-note")).toHaveTextContent(/Lab reset/));
    expect(fake.state.calls.some((c) => c.method === "POST" && c.path === "/api/reset")).toBe(true);
    expect(screen.getByTestId("flow-status")).toHaveTextContent("no flow open");
  });

  it("there is no redirect login: no redirect button or link, and authorize is only ever sent with response_mode=pi.flow", async () => {
    const user = await open();
    for (const tab of ["Sign in", "Step-up", "CIBA", "Passkey", "Scenarios", "Diagram", "Raw", "Talk track"]) {
      await user.click(screen.getByRole("link", { name: new RegExp(tab) }));
      expect(screen.queryByRole("button", { name: /redirect|hosted login/i })).toBeNull();
      expect(screen.queryByRole("link", { name: /redirect|hosted login/i })).toBeNull();
      expect(document.querySelector('a[href*="authorize"]')).toBeNull();
    }
    await user.click(screen.getByRole("link", { name: /Sign in/ }));
    await user.click(screen.getByRole("button", { name: /Open the flow/ }));
    await enabledField("Username");
    const authz = fake.state.calls.filter((c) => c.path.startsWith("/mock/authorize"));
    expect(authz).toHaveLength(1);
    expect(authz[0].path).toContain("response_mode=pi.flow");
  });
});
