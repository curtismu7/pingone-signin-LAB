import React from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { startFakeServer } from "./fakeServer.js";
import { open } from "./helpers.jsx";

let fake;
beforeAll(async () => { fake = await startFakeServer(); });
afterAll(() => fake.stop());
beforeEach(() => fake.reset());
afterEach(cleanup);

async function start(user, { binding = "AB12", expiry } = {}) {
  if (binding) await user.type(screen.getByLabelText(/binding_message/), binding);
  if (expiry) await user.type(screen.getByLabelText(/requested_expiry/), String(expiry));
  await user.click(screen.getByRole("button", { name: /Start \(POST/ }));
  await screen.findByTestId("auth-req-id");
}
const phone = () => screen.getByTestId("phone");

describe("CIBA tab", () => {
  it("is labelled mock, with a live binding_message counter", async () => {
    const user = await open("#/ciba");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/mock/i);
    const input = screen.getByLabelText(/binding_message/);
    expect(screen.getByTestId("bm-count")).toHaveTextContent("0 of 8");
    await user.type(input, "abc");
    expect(screen.getByTestId("bm-count")).toHaveTextContent("3 of 8");
    await user.type(input, "defghi");
    expect(screen.getByTestId("bm-count")).toHaveTextContent(/9 of 8.*over the limit/);
    expect(screen.getByTestId("bm-count")).toHaveAttribute("aria-live", "polite");
    await user.click(screen.getByRole("button", { name: /Start \(POST/ }));
    expect(await screen.findByTestId("ciba-error")).toHaveTextContent("invalid_binding_message");
  });

  it("approve on the mock phone, poll, tokens", async () => {
    const user = await open("#/ciba");
    await start(user);
    const n = await screen.findByTestId("phone-notification");
    expect(within(n).getByTestId("phone-binding")).toHaveTextContent("AB12");
    await user.click(within(phone()).getByRole("button", { name: "Approve" }));
    expect(await screen.findByTestId("phone-result")).toHaveTextContent("Approve");
    await user.click(screen.getByRole("button", { name: "Poll now" }));
    await waitFor(() => expect(screen.getByTestId("poll-state")).toHaveTextContent("approved"));
    expect(within(within(screen.getByTestId("tokens")).getByRole("table", { name: "id_token claims" })).getByRole("row", { name: /^amr/ })).toHaveTextContent("ciba");
    expect(screen.getByRole("button", { name: "Poll now" })).toHaveAttribute("aria-disabled", "true");
  });

  it("deny gives access_denied and no tokens", async () => {
    const user = await open("#/ciba");
    await start(user);
    await waitFor(() => expect(within(phone()).getByRole("button", { name: "Deny" })).not.toHaveAttribute("aria-disabled", "true"));
    await user.click(within(phone()).getByRole("button", { name: "Deny" }));
    await user.click(screen.getByRole("button", { name: "Poll now" }));
    await waitFor(() => expect(screen.getByTestId("poll-state")).toHaveTextContent("access_denied"));
    expect(screen.queryByTestId("tokens")).toBeNull();
  });

  it("pending, then slow_down raises the interval by the mock's 5 s", async () => {
    const user = await open("#/ciba");
    await start(user);
    await user.click(screen.getByRole("button", { name: "Poll now" }));
    await waitFor(() => expect(screen.getByTestId("poll-state")).toHaveTextContent("authorization_pending"));
    await user.click(screen.getByRole("button", { name: "Poll now" }));
    await waitFor(() => expect(screen.getByTestId("poll-state")).toHaveTextContent("slow_down"));
    expect(screen.getByTestId("interval")).toHaveTextContent("10 s");
  });

  it("expired_token once the deadline has passed", async () => {
    const user = await open("#/ciba");
    await start(user);
    fake.advance(121_000);
    await user.click(screen.getByRole("button", { name: "Poll now" }));
    await waitFor(() => expect(screen.getByTestId("poll-state")).toHaveTextContent("expired_token"));
    expect(screen.getByRole("button", { name: "Poll now" })).toHaveAttribute("aria-disabled", "true");
  });

  it("deciding after the deadline shows the phone's refusal", async () => {
    const user = await open("#/ciba");
    await start(user);
    const approve = await waitFor(() => { const b = within(phone()).getByRole("button", { name: "Approve" }); expect(b).not.toHaveAttribute("aria-disabled", "true"); return b; });
    fake.advance(121_000);
    await user.click(approve);
    expect(await screen.findByTestId("phone-error")).toHaveTextContent("expired_token");
  });

  describe("automatic polling", () => {
    afterEach(() => vi.useRealTimers());
    const tokenCalls = () => fake.state.calls.filter((c) => c.path === "/mock/token").length;

    it("polls at the server's interval while the tab is open (control)", async () => {
      const user = await open("#/ciba");
      await start(user);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
      act(() => { screen.getByLabelText(/Poll automatically/).click(); });
      const before = tokenCalls();
      await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
      expect(tokenCalls()).toBe(before + 1);
    });

    it("stops when the user switches to another tab: no /mock/token requests after that", async () => {
      const user = await open("#/ciba");
      await start(user);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
      act(() => { screen.getByLabelText(/Poll automatically/).click(); });
      // (jsdom delivers hashchange on a timer, which is faked here, so deliver it by hand)
      act(() => { window.location.hash = "#/scenarios"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
      expect(screen.queryByLabelText(/Poll automatically/)).toBeNull();
      await act(async () => { await Promise.resolve(); });
      const before = tokenCalls();
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(tokenCalls()).toBe(before);
    });
  });
});
