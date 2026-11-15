import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { startFakeServer } from "./fakeServer.js";
import { open, status, enabled } from "./helpers.jsx";

// Rule 24: every place the page shows JSON goes through the shared JsonPane (Form | JSON, important keys stood out, full view).

let fake;
beforeAll(async () => { fake = await startFakeServer(); });
afterAll(() => fake.stop());
beforeEach(() => fake.reset());
afterEach(cleanup);

async function signIn(user) {
  await user.click(screen.getByRole("button", { name: /Open the flow/ }));
  await waitFor(() => expect(screen.getByLabelText("Username")).toBeEnabled());
  await user.type(screen.getByLabelText("Username"), "{Control>}a{/Control}mark");
  await user.type(screen.getByLabelText("Password"), "mock-password");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(status()).toMatch(/COMPLETED/));
  await user.click(await enabled(/Resume/));
  await user.click(await enabled(/Exchange the code/));
  return screen.findByTestId("tokens");
}

describe("JSON panes", () => {
  it("decoded claims are a Form | JSON pane with the step-up claims stood out in both views", async () => {
    const user = await open();
    const tokens = await signIn(user);
    const pane = within(tokens).getByLabelText("id_token claims");
    expect(within(tokens).getAllByRole("button", { name: "Form" }).length).toBeGreaterThan(0);
    expect(pane.querySelectorAll('[data-hot="true"]').length).toBeGreaterThanOrEqual(4); // acr, amr, auth_time, nonce
    await user.click(within(tokens).getAllByRole("button", { name: "JSON" })[0]);
    const raw = within(tokens).getByLabelText("id_token claims");
    expect(raw.textContent).toContain('"acr": "mock:single"');
    expect([...raw.querySelectorAll(".jtok--hot")].map((n) => n.textContent)).toEqual(expect.arrayContaining(['"acr"', '"amr"', '"auth_time"', '"nonce"']));
    expect(within(tokens).getByTestId("raw-id-token").querySelectorAll(".jtok--jwt1,.jtok--jwt2,.jtok--jwt3")).toHaveLength(3); // the raw token: header, payload, signature
  });

  it("the trace keeps a hop's headers as text and gives its JSON body a Form | JSON pane; the Raw tab does the same", async () => {
    const user = await open();
    await signIn(user);
    const trace = screen.getByRole("region", { name: "Trace" });
    const head = within(trace).getByLabelText("Response 1 headers");
    expect(head.textContent).toMatch(/^HTTP\/1\.1 200/);
    expect(head.textContent).toContain("traceparent: ");
    expect(head.querySelector(".jtok")).toBeNull(); // headers are text, not JSON tokens
    expect(within(trace).getByLabelText("Response 1 body")).toBeInTheDocument(); // Form view
    await user.click(within(trace).getAllByRole("button", { name: "JSON" })[0]);
    const body = within(trace).getByLabelText("Response 1 body");
    expect(body.textContent).toMatch(/"status": "USERNAME_PASSWORD_REQUIRED"/);
    expect(body.querySelector(".jtok--key")).not.toBeNull();

    await user.click(screen.getByRole("tab", { name: /Raw/ }));
    const raw = screen.getAllByTestId("raw-response-box")[0];
    expect(within(raw).getByRole("button", { name: "Form" })).toBeInTheDocument();
    expect(within(raw).getByRole("button", { name: "JSON" })).toBeInTheDocument();
    expect(raw.querySelector(".jtok--key")).not.toBeNull(); // the view chosen above is shared by every pane on the page
  });

  it("the lab's own CSS never caps a JSON pane or a column that holds one", () => {
    const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../app.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const capped = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, sel, body]) => /\b(json|inert|trace|aside)\b|\.split\b/.test(sel) && /max-height\s*:\s*(?!none)|overflow(-y)?\s*:\s*(auto|scroll)/.test(body)).map(([, sel]) => sel.trim());
    expect(capped).toEqual([]);
  });
});
