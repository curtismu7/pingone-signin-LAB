import React from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { startFakeServer } from "./fakeServer.js";
import { open } from "./helpers.jsx";
import { parseChallenge } from "../lib/stepup.js";

let fake;
beforeAll(async () => { fake = await startFakeServer(); });
afterAll(() => fake.stop());
beforeEach(() => fake.reset());
afterEach(cleanup);

describe("Step-up tab", () => {
  it("low token -> 401 challenge parsed -> re-authorize -> retry 200", async () => {
    const user = await open("#/stepup");
    expect(screen.getByRole("button", { name: "Call POST /rs/transfer" })).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("button", { name: "Sign in (low acr)" }));
    await waitFor(() => expect(screen.getByTestId("low-acr")).toHaveTextContent("mock:single"));
    await user.click(screen.getByRole("button", { name: "Call POST /rs/transfer" }));
    const ch = await screen.findByTestId("challenge");
    expect(ch).toHaveTextContent("insufficient_user_authentication");
    expect(screen.getByTestId("challenge-acr")).toHaveTextContent("mock:multi");
    expect(screen.getByTestId("challenge-acr")).toHaveTextContent(/mock acr name/i);
    await user.click(screen.getByRole("button", { name: "Re-authorize (step up)" }));
    await waitFor(() => expect(screen.getByTestId("high-acr")).toHaveTextContent("mock:multi"));
    await user.click(screen.getByRole("button", { name: "Retry POST /rs/transfer" }));
    expect(await screen.findByTestId("retry-ok")).toHaveTextContent('"transferred":true');
    // the re-authorization really carried the challenge's acr_values
    expect(fake.state.calls.filter((c) => c.path.startsWith("/mock/authorize") && c.path.includes("acr_values=mock%3Amulti"))).toHaveLength(1);
  });

  it("the contrast read works with the low token", async () => {
    const user = await open("#/stepup");
    await user.click(screen.getByRole("button", { name: "Sign in (low acr)" }));
    await waitFor(() => expect(screen.getByTestId("low-acr")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Contrast: GET /rs/balance" }));
    expect(await screen.findByTestId("balance")).toHaveTextContent("200");
  });
});

describe("parseChallenge", () => {
  it("parses an RFC 9470 header and rejects junk", () => {
    expect(parseChallenge('Bearer error="insufficient_user_authentication", acr_values="mock:multi", max_age="300"')).toEqual({ scheme: "Bearer", error: "insufficient_user_authentication", acr_values: ["mock:multi"], max_age: 300 });
    expect(parseChallenge("Basic realm=x")).toBeNull();
    expect(parseChallenge(null)).toBeNull();
    expect(parseChallenge('Bearer realm="x"')).toBeNull();
  });
});
