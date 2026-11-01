import React from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { startFakeServer } from "./fakeServer.js";
import { open } from "./helpers.jsx";

let fake;
beforeAll(async () => { fake = await startFakeServer(); });
afterAll(() => fake.stop());
beforeEach(() => fake.reset());
afterEach(cleanup);

describe("Scenarios tab", () => {
  it("lists the server's 16 scenarios and Run all passes every one", async () => {
    const user = await open("#/scenarios");
    expect(document.querySelectorAll('[data-testid^="scenario-S"]')).toHaveLength(16);
    await user.click(screen.getByRole("button", { name: "Run all" }));
    await waitFor(() => expect(screen.getByTestId("scenario-summary")).toHaveTextContent("16 of 16 behaved as written."));
    expect(screen.getAllByText("PASS")).toHaveLength(16);
    expect(screen.queryAllByText("FAIL")).toHaveLength(0);
  });

  it("one run shows expected versus actual and the trace; the vertical picker changes the cast and clears results", async () => {
    const user = await open("#/scenarios");
    await user.click(screen.getByRole("button", { name: "Run S01" }));
    const card = await screen.findByTestId("scenario-S01");
    await waitFor(() => expect(within(card).getByTestId("result-S01")).toHaveTextContent("PASS"));
    expect(within(card).getByRole("table", { name: "Expected versus actual" })).toHaveTextContent("mock:single");
    expect(card).toHaveTextContent("Mark Ellison");
    expect(card).toHaveTextContent(/Trace \(\d+ calls\)/);
    await user.selectOptions(screen.getByLabelText("Vertical"), "banking");
    await waitFor(() => expect(screen.getByTestId("scenario-S01")).toHaveTextContent("Alice Moreau"));
    expect(screen.queryByTestId("result-S01")).toBeNull();
  });

  it("the redirect-login-refused scenario is shown as a refusal scenario, not a login path", async () => {
    await open("#/scenarios");
    const s = screen.getByTestId("scenario-S08");
    expect(s).toHaveTextContent(/redirect/i);
    expect(within(s).getByText("should be refused")).toBeInTheDocument();
    expect(within(s).queryByRole("link")).toBeNull();
  });
});
