import React from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { hold as holdWith, startFakeServer } from "./fakeServer.js";
import { open, enabled } from "./helpers.jsx";

// The controls are always on screen, greyed out until their step is ready, so wait for enabled ones.
const enabledField = (label) => waitFor(() => { const f = screen.getByLabelText(label); expect(f).toBeEnabled(); return f; });


let fake;
beforeAll(async () => { fake = await startFakeServer(); });
afterAll(() => fake.stop());
beforeEach(() => fake.reset());
afterEach(cleanup);

describe("late answers after Start over or Reset are dropped", () => {
  it("CIBA: a poll that is in flight when Start over is pressed does not bring tokens back", async () => {
    const user = await open("#/ciba");
    await user.click(screen.getByRole("button", { name: /Start \(POST/ }));
    await screen.findByTestId("auth-req-id");
    await user.click(await enabled("Approve"));
    await screen.findByTestId("phone-result");
    const h = holdWith(fake, (p) => p === "/mock/token");
    await user.click(screen.getByRole("button", { name: "Poll now" }));
    await waitFor(() => expect(h.wasHeld()).toBe(true));
    await user.click(screen.getByRole("button", { name: "Start over" }));
    h.release();
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByTestId("tokens")).toBeNull();
    expect(screen.queryByTestId("poll-state")).toBeNull();
    expect(screen.getByRole("region", { name: "Trace" })).toHaveTextContent("Nothing sent yet");
  });

  it("Step-up: a sign-in that finishes after Start over leaves the tab empty", async () => {
    const user = await open("#/stepup");
    const h = holdWith(fake, (p) => p === "/mock/token");
    await user.click(screen.getByRole("button", { name: "Sign in (low acr)" }));
    await waitFor(() => expect(h.wasHeld()).toBe(true));
    await user.click(screen.getByRole("button", { name: "Start over" }));
    h.release();
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByTestId("low-acr")).toBeNull();
    expect(screen.queryByTestId("tokens")).toBeNull();
    expect(screen.getByRole("region", { name: "Trace" })).toHaveTextContent("Nothing sent yet");
  });

  it("Sign in: an exchange that finishes after Reset lab shows no tokens", async () => {
    const user = await open("#/signin");
    await user.click(screen.getByRole("button", { name: /Open the flow/ }));
    await user.type(await enabledField("Username"), "{Control>}a{/Control}mark");
    await user.type(screen.getByLabelText("Password"), "mock-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.click(await screen.findByRole("button", { name: /Resume/ }));
    await user.click(await screen.findByRole("button", { name: /Exchange the code/ }));
    // (the real exchange already finished; now start a second, held one)
    await screen.findByTestId("signed-in");
    await user.click(screen.getByRole("button", { name: "Start over" }));
    await user.click(screen.getByRole("button", { name: /Open the flow/ }));
    await user.type(await enabledField("Username"), "{Control>}a{/Control}mark");
    await user.type(screen.getByLabelText("Password"), "mock-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.click(await screen.findByRole("button", { name: /Resume/ }));
    const exchange = await screen.findByRole("button", { name: /Exchange the code/ });
    const h = holdWith(fake, (p) => p === "/mock/token");
    await user.click(exchange);
    await waitFor(() => expect(h.wasHeld()).toBe(true));
    await user.click(screen.getByTestId("reset"));
    await waitFor(() => expect(screen.getByTestId("reset-note")).toHaveTextContent(/Lab reset/));
    h.release();
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByTestId("tokens")).toBeNull();
    expect(screen.queryByTestId("signed-in")).toBeNull();
    expect(screen.getByTestId("flow-status")).toHaveTextContent("no flow open");
  });

  it("Scenarios: a Run all that returns after Clear results shows nothing", async () => {
    const user = await open("#/scenarios");
    const h = holdWith(fake, (p) => p === "/api/run-all");
    await user.click(screen.getByRole("button", { name: "Run all" }));
    await waitFor(() => expect(h.wasHeld()).toBe(true));
    await user.click(screen.getByRole("button", { name: "Clear results" }));
    h.release();
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryAllByText("PASS")).toHaveLength(0);
    expect(screen.getByTestId("scenario-summary")).toHaveTextContent("");
    expect(screen.getByRole("button", { name: "Run all" })).not.toHaveAttribute("aria-disabled", "true");
  });
});
