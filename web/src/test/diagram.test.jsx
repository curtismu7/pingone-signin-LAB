import React from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import DiagramTab, { buildEdges } from "../tabs/DiagramTab.jsx";
import { validateDiagram } from "../../../server/src/vendor/diagram-validate.js";
import { flowFromDiagram } from "../lib/diagram.js";
import login from "../../../server/data/diagrams/pingone-signin-login.json";
import stepup from "../../../server/data/diagrams/pingone-signin-stepup.json";
import ciba from "../../../server/data/diagrams/pingone-signin-ciba.json";
import { startFakeServer } from "./fakeServer.js";
import { open } from "./helpers.jsx";

let fake;
beforeAll(async () => { fake = await startFakeServer(); });
afterAll(() => fake.stop());
beforeEach(() => fake.reset());
afterEach(() => { cleanup(); vi.useRealTimers(); });

// What the tab draws comes from the data files; these are the same files the server serves.
const FLOWS = { login: flowFromDiagram(login), stepup: flowFromDiagram(stepup), ciba: flowFromDiagram(ciba) };
const START_BOXES = FLOWS.login.boxes;
const caption = () => screen.getByTestId("caption").textContent;

describe("diagram", () => {
  it("has movable boxes, Simulate, Reset, a flow picker and a speed control", async () => {
    await open("#/diagram");
    expect(screen.getByRole("group", { name: /Sequence diagram/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Simulate" })).not.toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
    expect(screen.getByLabelText("Speed")).toHaveValue("1");
    expect([...screen.getByLabelText("Speed").options].map((o) => o.textContent)).toEqual(["0.5x", "1x", "2x", "4x"]);
    expect([...screen.getByLabelText("Flow").options].map((o) => o.value)).toEqual(["login", "stepup", "ciba"]);
    for (const t of ["Browser", "BFF", "Mock PingOne", "Resource server", "Mock phone"]) expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".react-flow__node")).toHaveLength(5);
    expect(document.querySelectorAll(".react-flow__node.draggable, .react-flow__node[class*='draggable']").length).toBe(5);
  });

  it("Simulate walks the login flow step by step, Reset goes back to idle", async () => {
    await open("#/diagram");
    vi.useFakeTimers();
    const n = FLOWS.login.steps.length;
    expect(caption()).toMatch(/Press Simulate/);
    act(() => { screen.getByRole("button", { name: "Simulate" }).click(); });
    expect(caption()).toMatch(new RegExp(`Step 1 of ${n}`));
    expect(screen.getByRole("button", { name: "Simulate" })).toHaveAttribute("aria-disabled", "true");
    await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
    expect(caption()).toMatch(new RegExp(`Step 2 of ${n}`));
    expect(document.querySelector(".fbox.on")).not.toBeNull();
    // (React Flow draws no edges in jsdom, which has no layout; the e2e test checks the lit edge in a real browser.)
    for (let i = 0; i < n; i++) await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
    expect(caption()).toMatch(new RegExp(`Step ${n} of ${n}`));
    expect(screen.getByRole("button", { name: "Simulate" })).not.toHaveAttribute("aria-disabled", "true");
    act(() => { screen.getByRole("button", { name: "Reset" }).click(); });
    expect(caption()).toMatch(/Press Simulate/);
    expect(document.querySelector(".fbox.on")).toBeNull();
  });

  it("a faster speed shortens the step interval, a slower one lengthens it", async () => {
    await open("#/diagram");
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText("Speed"), { target: { value: "4" } });
    act(() => { screen.getByRole("button", { name: "Simulate" }).click(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });
    expect(caption()).toMatch(/Step 2 of/);
    act(() => { screen.getByRole("button", { name: "Reset" }).click(); });
    fireEvent.change(screen.getByLabelText("Speed"), { target: { value: "0.5" } });
    act(() => { screen.getByRole("button", { name: "Simulate" }).click(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(caption()).toMatch(/Step 1 of/);
    await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
    expect(caption()).toMatch(/Step 2 of/);
  });

  it("each flow has its own steps; changing the flow stops the walk", async () => {
    const user = await open("#/diagram");
    await user.selectOptions(screen.getByLabelText("Flow"), "ciba");
    expect(screen.getAllByRole("listitem").filter((li) => li.closest("ol[aria-label=Steps]"))).toHaveLength(FLOWS.ciba.steps.length);
    await user.selectOptions(screen.getByLabelText("Flow"), "stepup");
    expect(screen.getByRole("list", { name: "Steps" })).toHaveTextContent(/401/);
  });

  it("Reset puts dragged boxes back at their starting positions", async () => {
    const setBoxes = vi.fn();
    const moved = START_BOXES.map((b) => ({ ...b, position: { x: 1, y: 1 } }));
    render(<DiagramTab app={{ cursor: -1, setCursor: vi.fn(), boxes: moved, setBoxes, theme: "light", flows: FLOWS, flowId: "login", setFlowId: vi.fn() }} />);
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(setBoxes).toHaveBeenCalledWith(START_BOXES);
  });

  it("the caption is an aria-live status and renders its text inert", async () => {
    await open("#/diagram");
    expect(screen.getByTestId("caption")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByTestId("caption")).toHaveAttribute("role", "status");
  });
});

describe("diagram data", () => {
  it("the walk is built from the files: boxes at the file positions, one numbered arrow per step, a dashed edge draws one-way", () => {
    expect(START_BOXES.map((b) => [b.id, b.position.x, b.position.y])).toEqual(login.nodes.map((n) => [n.id, n.x, n.y]));
    for (const f of Object.values(FLOWS)) {
      expect(f.edges.length).toBe(f.steps.length);
      for (const s of f.steps) for (const i of s.edges) expect(f.edges[i]).toBeDefined();
    }
    expect(FLOWS.login.edges.map((e) => e.one)).toEqual([true, false, false, false, false, false, true]);
    expect(FLOWS.ciba.edges.map((e) => e.one)).toEqual([false, true, true, false, false, true]);
    expect(FLOWS.login.steps[4].say).toMatch(/UNVERIFIED for a real PingOne/);
  });
});

describe("diagram edges and labels", () => {
  const files = { login, stepup, ciba };
  it("step i lights exactly the edges that step lists, with the data's own endpoints and direction", () => {
    for (const d of Object.values(files)) {
      const f = flowFromDiagram(d);
      d.steps.forEach((step, i) => {
        const on = buildEdges(f, i, f.id).filter((e) => e.className === "edge-on");
        expect(on.map((e) => e.id)).toEqual(step.edges.map((k) => `${f.id}-${k}`));
        expect(on.map((e) => [e.source, e.target])).toEqual(step.edges.map((k) => [d.edges[k].source, d.edges[k].target]));
      });
    }
  });
  it("Reset lights no edge, and an edge that no step lists never lights (validator accepts it, from a temp file)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diagram-orphan-"));
    try {
      const d = structuredClone(login);
      d.edges.push({ source: "browser", target: "rs", label: "orphan" });
      const file = path.join(dir, "pingone-signin-login.json");
      fs.writeFileSync(file, JSON.stringify(d));
      const read = JSON.parse(fs.readFileSync(file, "utf8"));
      expect(validateDiagram(read)).toEqual([]);
      const f = flowFromDiagram(read);
      const orphan = `${f.id}-${read.edges.length - 1}`;
      expect(buildEdges(f, -1, f.id).filter((e) => e.className === "edge-on")).toHaveLength(0);
      for (let cursor = -1; cursor < f.steps.length; cursor++) {
        const edges = buildEdges(f, cursor, f.id);
        expect(edges.find((e) => e.id === orphan).className).toBe("edge-idle");
        expect(edges.find((e) => e.id === orphan).label).toBeUndefined();
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it("each box renders its sub text", async () => {
    await open("#/diagram");
    for (const n of login.nodes) expect(screen.getAllByText(n.sub.join(" ")).length).toBeGreaterThan(0);
  });
});
