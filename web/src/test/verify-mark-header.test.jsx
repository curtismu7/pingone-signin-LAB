import React from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { jsonResponse, startFakeServer } from "./fakeServer.js";
import { open } from "./helpers.jsx";

// The header shows this lab's own Verified / In progress mark, read from the same /api/shelf call the Shelf button makes (through the lab-proxy that
// call reaches the shelf, whose payload lists every demo with its mark). The lab's own /api/shelf has no demos, so there is no mark then.
let fake;
beforeAll(async () => { fake = await startFakeServer(); });
afterAll(() => fake.stop());
beforeEach(() => { fake.reset(); try { localStorage.clear(); } catch { /* none */ } delete document.documentElement.dataset.theme; });
afterEach(cleanup);

const mark = (status, label, extra = {}) => ({ status, label, note: "", updatedAt: "2026-11-15", source: "shipped", ...extra });
const shelf = (payload) => { fake.state.intercept = (path) => (path === "/api/shelf" ? jsonResponse(payload) : null); };

describe("verification mark in the header", () => {
  it("shows this lab's own mark in the top menu, and no other lab's, with the page's traceparent", async () => {
    shelf({ shelfUrl: "http://shelf.example", demos: [{ id: "other-lab", verification: mark("in-progress", "In progress") }, { id: "pingone-signin-lab", verification: mark("verified", "Verified", { note: "Every scenario run on the mock" }) }] });
    await open();
    const bar = within(screen.getByTestId("top-menu"));
    expect(await bar.findByText("Verified")).toBeInTheDocument();
    expect(bar.queryByText("In progress")).toBeNull();
    expect(document.querySelectorAll(".verify").length).toBe(1);
    expect(bar.getByText("Verified").closest(".verify")).toHaveAttribute("title", expect.stringContaining("Every scenario run on the mock"));
    const calls = fake.state.calls.filter((c) => c.path === "/api/shelf");
    expect(calls.length).toBeGreaterThanOrEqual(2); // the Shelf button and the mark
    for (const c of calls) expect(c.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it("shows nothing when the lab is opened on its own port ({ shelfUrl } only) or the shelf has no mark for it", async () => {
    for (const payload of [{ shelfUrl: "http://shelf.example" }, { shelfUrl: "http://shelf.example", demos: [{ id: "pingone-signin-lab", verification: null }] }, { shelfUrl: "http://shelf.example", demos: [{ id: "pingone-signin-lab", verification: mark("none", "None") }] }]) {
      shelf(payload);
      await open();
      const shelfCall = () => fake.state.calls.some((c) => c.path === "/api/shelf");
      await screen.findByTestId("top-menu");
      await new Promise((r) => setTimeout(r, 150));
      expect(shelfCall()).toBe(true);
      expect(document.querySelector(".verify")).toBeNull();
      cleanup();
      fake.state.calls = [];
    }
  });
});
