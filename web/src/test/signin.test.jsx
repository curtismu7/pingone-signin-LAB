import React from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { hold, jsonResponse, startFakeServer } from "./fakeServer.js";
import { open, status, enabled } from "./helpers.jsx";
import { PiFlowClient } from "../lib/flow.js";
import { createTracer } from "../lib/trace.js";

// The controls are always on screen, greyed out until their step is ready, so wait for enabled ones.
const enabledField = (label) => waitFor(() => { const f = screen.getByLabelText(label); expect(f).toBeEnabled(); return f; });


let fake;
beforeAll(async () => { fake = await startFakeServer(); });
afterAll(() => fake.stop());
beforeEach(() => fake.reset());
afterEach(cleanup);

async function login(user, name, pw = "mock-password") {
  await user.click(screen.getByRole("button", { name: /Open the flow/ }));
  await user.type(await enabledField("Username"), `{Control>}a{/Control}${name}`);
  await user.type(screen.getByLabelText("Password"), pw);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("PiFlowClient", () => {
  it("a full sign-in reads the state from authorizeResponse, so stateOk and nonceOk are true", async () => {
    const r = await new PiFlowClient({ tracer: createTracer(), redirectUri: "https://app.lab.example/callback" }).run({ username: "mark", password: "mock-password" });
    expect(r.ok).toBe(true);
    expect(r.stateOk).toBe(true);
    expect(r.nonceOk).toBe(true);
  });
});

describe("Sign in tab", () => {
  it("shows the seeded users with their mock password, labelled fictional", async () => {
    await open();
    expect(screen.getByTestId("mock-password")).toHaveTextContent("mock-password");
    expect(screen.getByTestId("mock-otp")).toHaveTextContent("424242");
    const users = screen.getByRole("region", { name: "Seeded users" });
    for (const u of ["mark", "dana", "priya"]) expect(within(users).getByText(u)).toBeInTheDocument();
    expect(users).toHaveTextContent(/fictional/i);
  });

  it("happy path: password, resume, exchange, then the decoded claims", async () => {
    const user = await open();
    await login(user, "mark");
    await waitFor(() => expect(status()).toMatch(/COMPLETED/));
    expect(screen.getByRole("button", { name: /Exchange the code/ })).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("button", { name: /Resume/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Exchange the code/ })).not.toHaveAttribute("aria-disabled", "true"));
    expect(screen.getByRole("button", { name: /Resume/ })).toHaveAttribute("aria-disabled", "true"); // the code is fetched: a second resume would be refused
    await user.click(screen.getByRole("button", { name: /Exchange the code/ }));
    const tokens = await screen.findByTestId("tokens");
    expect(within(within(tokens).getByRole("table", { name: "id_token claims" })).getByRole("row", { name: /^acr/ })).toHaveTextContent("mock:single");
    expect(within(within(tokens).getByRole("table", { name: "id_token claims" })).getByRole("row", { name: /^amr/ })).toHaveTextContent("pwd");
    expect(within(within(tokens).getByRole("table", { name: "id_token claims" })).getByRole("row", { name: /^auth_time/ })).toHaveTextContent(/\d{4}-\d{2}-\d{2}T/);
    expect(within(within(tokens).getByRole("table", { name: "id_token claims" })).getByRole("row", { name: /^nonce/ })).toHaveTextContent("matches the nonce we sent");
    expect(within(tokens).getAllByText(/mock/i).length).toBeGreaterThan(0);
  });

  it("the trace shows each call, masks the password and shortens the rotating cookie", async () => {
    const user = await open();
    await login(user, "mark");
    await waitFor(() => expect(status()).toMatch(/COMPLETED/));
    const pane = screen.getByRole("region", { name: "Trace" });
    expect(pane.textContent).toContain("********");
    expect(pane.textContent).not.toContain("mock-password");
    const seen = [...new Set([...pane.textContent.matchAll(/ST=([A-Za-z0-9_-]{6})…/g)].map((m) => m[1]))];
    expect(seen.length).toBeGreaterThanOrEqual(2); // rotated at least once
    expect(pane.textContent).not.toMatch(/ST=[A-Za-z0-9_-]{9,}/);
  });

  it("MFA user: device selection, passcode, acr mock:multi", async () => {
    const user = await open();
    await login(user, "priya");
    await waitFor(() => expect(status()).toMatch(/DEVICE_SELECTION_REQUIRED/));
    await user.click(screen.getByLabelText(/EMAIL/));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(status()).toMatch(/OTP_REQUIRED/));
    await user.type(screen.getByLabelText(/One-time passcode/), "424242");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(status()).toMatch(/COMPLETED/));
    await user.click(screen.getByRole("button", { name: /Resume/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Exchange the code/ })).not.toHaveAttribute("aria-disabled", "true"));
    await user.click(screen.getByRole("button", { name: /Exchange the code/ }));
    expect(within(within(await screen.findByTestId("tokens")).getByRole("table", { name: "id_token claims" })).getByRole("row", { name: /^acr/ })).toHaveTextContent("mock:multi");
  });

  it("a wrong password keeps the flow open with an attempt counter, then success", async () => {
    const user = await open();
    await login(user, "mark", "wrong");
    const err = await screen.findByTestId("flow-error");
    expect(err).toHaveTextContent("INVALID_CREDENTIALS");
    expect(err).toHaveTextContent("Attempts used 1 of 3");
    expect(status()).toMatch(/USERNAME_PASSWORD_REQUIRED/);
    await user.type(screen.getByLabelText("Password"), "mock-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(status()).toMatch(/COMPLETED/));
    expect(screen.queryByTestId("flow-error")).toBeNull();
  });

  it("lockout after three wrong passwords refuses even the right one", async () => {
    const user = await open();
    await login(user, "dana", "x");
    for (let i = 0; i < 2; i++) { await user.type(screen.getByLabelText("Password"), "x"); await user.click(screen.getByRole("button", { name: "Sign in" })); }
    await waitFor(() => expect(screen.getByTestId("flow-error")).toHaveTextContent("ACCOUNT_LOCKED"));
    await user.type(screen.getByLabelText("Password"), "mock-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByTestId("flow-error")).toHaveTextContent("ACCOUNT_LOCKED"));
    expect(status()).toMatch(/USERNAME_PASSWORD_REQUIRED/);
  });

  it("an expired flow is called out and Start over returns to the start", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: /Open the flow/ }));
    await enabledField("Username");
    fake.advance(10 * 60 * 1000);
    await user.type(screen.getByLabelText("Username"), "{Control>}a{/Control}mark");
    await user.type(screen.getByLabelText("Password"), "mock-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByTestId("flow-error")).toHaveTextContent("FLOW_EXPIRED");
    await user.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.getByRole("button", { name: /Open the flow/ })).toBeInTheDocument();
  });

  it("flow status changes are announced in an aria-live region and focus moves to the next input", async () => {
    const user = await open();
    expect(screen.getByTestId("flow-status")).toHaveAttribute("aria-live", "polite");
    await user.click(screen.getByRole("button", { name: /Open the flow/ }));
    await waitFor(() => expect(screen.getByLabelText("Username")).toHaveFocus());
    await user.keyboard("{Control>}a{/Control}mark");
    await user.tab(); await user.keyboard("mock-password{Enter}");
    await waitFor(() => expect(screen.getByRole("button", { name: /Resume/ })).toHaveFocus());
  });

  it("after a refused attempt focus is on Password, and typing there right away does not touch Username", async () => {
    const user = await open();
    await login(user, "mark", "wrong");
    await screen.findByTestId("flow-error");
    await waitFor(() => expect(screen.getByLabelText("Password")).toHaveFocus());
    await user.keyboard("abcdef");
    expect(screen.getByLabelText("Password")).toHaveValue("abcdef");
    expect(screen.getByLabelText("Username")).toHaveValue("mark");
  });

  it("a second refusal does not pull focus back from an input the user already moved to", async () => {
    const user = await open();
    await login(user, "mark", "wrong");
    await screen.findByTestId("flow-error");
    await user.click(screen.getByLabelText("Username")); // the user goes back to fix the name
    await user.type(screen.getByLabelText("Password"), "x");
    const h = hold(fake, (p) => p.startsWith("/mock/flows/"));
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(h.wasHeld()).toBe(true));
    await user.click(screen.getByLabelText("Username")); // moves to Username while the request runs
    h.release();
    await waitFor(() => expect(screen.getByTestId("flow-error")).toHaveTextContent("Attempts used 2 of 3"));
    expect(screen.getByLabelText("Username")).toHaveFocus();
  });

  it("nothing is focused on first load, so the skip link is the first Tab stop", async () => {
    const user = await open();
    expect(document.activeElement).toBe(document.body);
    await user.tab();
    expect(document.activeElement).toHaveClass("skip");
  });

  it("hostile text from the server is shown as text, never run", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: /Open the flow/ }));
    await enabledField("Username");
    const evil = '<img src=x onerror="window.__pwn=1"><script>window.__pwn=2</script>‮';
    fake.state.intercept = (p) => (p.startsWith("/mock/flows/") ? jsonResponse({ code: "<img src=x onerror=window.__pwn=3>", message: evil }, 400) : null);
    await user.type(screen.getByLabelText("Username"), "{Control>}a{/Control}mark");
    await user.type(screen.getByLabelText("Password"), "x");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    const err = await screen.findByTestId("flow-error");
    expect(err.textContent).toContain("<img src=x onerror=");
    expect(err.textContent).toContain("[U+202E]");
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("script[src], main script")).toBeNull();
    expect(window.__pwn).toBeUndefined();
    expect(screen.getByRole("region", { name: "Trace" }).textContent).toContain("<img src=x");
  });
});
