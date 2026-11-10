import React from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { startFakeServer } from "./fakeServer.js";
import { open, enabled } from "./helpers.jsx";
import { b64u, unb64u, browserPasskeySupport, createSimulatedAuthenticator, credentialToJSON, p1363ToDer, toCreateOptions, toGetOptions } from "../lib/webauthn.js";

// jsdom's own origin is not the fake server's; a browser puts the page origin in clientDataJSON, so stand in the server's.
const origin = vi.hoisted(() => ({ value: "" }));
vi.mock("../lib/webauthn.js", async (orig) => ({ ...(await orig()), pageOrigin: () => origin.value }));

let fake;
beforeAll(async () => { fake = await startFakeServer(); origin.value = fake.base; });
afterAll(() => fake.stop());
beforeEach(() => fake.reset());
afterEach(() => { cleanup(); delete window.PublicKeyCredential; vi.unstubAllGlobals(); });

const click = async (user, name) => user.click(await enabled(name));
const checks = (id) => [...screen.getByTestId(id).querySelectorAll("li")].map((li) => [li.dataset.check, li.dataset.ok]);

describe("Passkey tab (Mock, simulated authenticator)", () => {
  it("registers and signs in step by step, showing options, clientDataJSON, flags and every server check; a replay is refused", async () => {
    const user = await open("#/passkey");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Passkey (WebAuthn)");
    // jsdom has no WebAuthn: the browser choice is refused with the reason, the simulated one is chosen and labelled
    expect(screen.getByTestId("auth-browser")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("browser-unavailable")).toHaveTextContent(/no WebAuthn/);
    expect(screen.getByTestId("auth-simulated")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("sim-note")).toHaveTextContent(/SIMULATED/);
    expect(screen.getByRole("button", { name: "Create the passkey" })).toHaveAttribute("aria-disabled", "true");

    await click(user, "Get registration options");
    const regOpts = await screen.findByLabelText("registration options");
    expect(regOpts).toHaveTextContent("rp.id127.0.0.1");
    expect(regOpts).toHaveTextContent(/user\.id[A-Za-z0-9_-]{22}/);
    expect(regOpts).toHaveTextContent(/challenge[A-Za-z0-9_-]{43}/);
    expect(regOpts).toHaveTextContent(`expected origin${origin.value}`);
    expect(screen.getByTestId("ip-rpid")).toHaveTextContent(/IP address: a real browser refuses it/);

    await click(user, "Create the passkey");
    const cd = await screen.findByTestId("reg-clientdata");
    expect(cd).toHaveTextContent("typewebauthn.create");
    expect(cd).toHaveTextContent(`origin${origin.value}`);

    await click(user, "Verify the registration");
    await screen.findByTestId("reg-checks");
    expect(checks("reg-checks").every(([, ok]) => ok === "1")).toBe(true);
    expect(checks("reg-checks").map(([id]) => id)).toEqual(expect.arrayContaining(["challenge", "origin", "rpIdHash", "UP", "alg"]));
    expect(within(screen.getByTestId("reg-authdata")).getByTestId("flag-UP")).toHaveTextContent("UP set");
    expect(within(screen.getByTestId("reg-authdata")).getByTestId("flag-UV")).toHaveTextContent("UV set");
    expect(within(screen.getByTestId("reg-authdata")).getByTestId("flag-BE")).toHaveTextContent("BE not set");
    expect(within(screen.getByTestId("reg-authdata")).getByTestId("flag-BS")).toHaveTextContent("BS not set");
    expect(within(screen.getByTestId("reg-checks")).getByRole("status")).toHaveTextContent("Verified: mark");

    await click(user, "Get sign-in options");
    expect(await screen.findByLabelText("sign-in options")).toHaveTextContent("rpId127.0.0.1");
    await click(user, "Sign with the passkey");
    expect(await screen.findByTestId("auth-clientdata")).toHaveTextContent("typewebauthn.get");
    expect(screen.getByLabelText("assertion")).toHaveTextContent(/signature \(DER, base64url\)MEU|signature \(DER, base64url\)MEQ/);
    await click(user, "Verify the assertion");
    await screen.findByTestId("auth-checks");
    expect(checks("auth-checks")).toEqual(expect.arrayContaining([["signature", "1"], ["signCount", "1"], ["challenge", "1"]]));
    expect(screen.getByTestId("auth-authdata")).toHaveTextContent("1 (stored before: 0)");

    await click(user, "Replay the same assertion");
    await screen.findByTestId("replay-checks");
    expect(checks("replay-checks")).toEqual(expect.arrayContaining([["challenge", "0"], ["signCount", "0"]]));
    expect(within(screen.getByTestId("replay-checks")).getByRole("status")).toHaveTextContent(/Refused: .*challenge/);
    // every call went to this page's own mock RP, with a traceparent
    const rp = fake.state.calls.filter((c) => c.path.startsWith("/mock/passkey/"));
    expect(rp.map((c) => c.path)).toEqual(["/mock/passkey/register/options", "/mock/passkey/register/verify", "/mock/passkey/login/options", "/mock/passkey/login/verify", "/mock/passkey/login/verify"]);
    for (const c of rp) expect(c.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it("Start over clears the ceremony and the simulated authenticator's keys", async () => {
    const user = await open("#/passkey");
    await click(user, "Get registration options");
    await click(user, "Create the passkey");
    await screen.findByTestId("reg-clientdata");
    await user.click(screen.getByRole("button", { name: "Start over" }));
    await waitFor(() => expect(screen.queryByTestId("reg-clientdata")).toBeNull());
    expect(screen.getByRole("button", { name: "Create the passkey" })).toHaveAttribute("aria-disabled", "true");
  });

  it("the Real card says honestly that PingOne's FIDO2 step needs tenant setup, and names the RP ID trap", async () => {
    await open("#/passkey");
    const real = screen.getByTestId("passkey-real");
    expect(real).toHaveTextContent("needs tenant setup");
    expect(real).toHaveTextContent(/not run here/);
    expect(within(real).getByRole("heading", { name: /What the owner configures/ })).toHaveTextContent("UNVERIFIED");
    expect(real).toHaveTextContent(/MFA enabled/);
    for (const must of ["FIDO policy", "device authentication policy", "Authentication (sign-on) policy", "pi.flow"]) expect(real).toHaveTextContent(must);
    expect(screen.getByTestId("rpid-trap")).toHaveTextContent(/RP ID must match the page's domain/);
    expect(screen.getByTestId("rpid-trap")).toHaveTextContent(/IP address is never a valid RP ID/);
  });
});

describe("Passkey tab (Mock, this browser's navigator.credentials)", () => {
  it("uses navigator.credentials with ArrayBuffer options and posts the JSON form", async () => {
    // A stand-in browser authenticator: takes the ArrayBuffer options like a browser, answers with ArrayBuffers.
    const sim = createSimulatedAuthenticator();
    const buf = (s) => unb64u(s).buffer;
    const seen = {};
    const create = vi.fn(async ({ publicKey }) => {
      seen.create = publicKey;
      const j = await sim.create({ ...publicKey, challenge: b64u(publicKey.challenge), user: { ...publicKey.user, id: b64u(publicKey.user.id) } }, origin.value);
      return { id: j.id, rawId: buf(j.rawId), type: "public-key", authenticatorAttachment: "platform", response: { clientDataJSON: buf(j.response.clientDataJSON), attestationObject: buf(j.response.attestationObject) } };
    });
    const get = vi.fn(async ({ publicKey }) => {
      seen.get = publicKey;
      const j = await sim.get({ ...publicKey, challenge: b64u(publicKey.challenge), allowCredentials: publicKey.allowCredentials.map((c) => ({ ...c, id: b64u(c.id) })) }, origin.value);
      return { id: j.id, rawId: buf(j.rawId), type: "public-key", response: { clientDataJSON: buf(j.response.clientDataJSON), authenticatorData: buf(j.response.authenticatorData), signature: buf(j.response.signature), userHandle: buf(j.response.userHandle) } };
    });
    window.PublicKeyCredential = function PublicKeyCredential() {};
    vi.stubGlobal("isSecureContext", true);
    Object.defineProperty(navigator, "credentials", { configurable: true, value: { create, get } });
    try {
      const user = await open("#/passkey");
      expect(screen.getByTestId("auth-browser")).toHaveAttribute("aria-pressed", "true");
      await click(user, "Get registration options");
      await click(user, "Create the passkey");
      await screen.findByTestId("reg-clientdata");
      expect(seen.create.challenge).toBeInstanceOf(Uint8Array);
      expect(seen.create.user.id).toBeInstanceOf(Uint8Array);
      await click(user, "Verify the registration");
      await waitFor(() => expect(within(screen.getByTestId("reg-checks")).getByRole("status")).toHaveTextContent("Verified"));
      await click(user, "Get sign-in options");
      await click(user, "Sign with the passkey");
      await screen.findByTestId("auth-clientdata");
      expect(seen.get.allowCredentials[0].id).toBeInstanceOf(Uint8Array);
      await click(user, "Verify the assertion");
      await waitFor(() => expect(within(screen.getByTestId("auth-checks")).getByRole("status")).toHaveTextContent("Verified: mark"));
      expect(create).toHaveBeenCalledTimes(1); expect(get).toHaveBeenCalledTimes(1);
    } finally { delete navigator.credentials; }
  });

  it("a browser refusal (NotAllowedError) is shown, not swallowed", async () => {
    window.PublicKeyCredential = function PublicKeyCredential() {};
    vi.stubGlobal("isSecureContext", true);
    const err = Object.assign(new Error("The operation either timed out or was not allowed."), { name: "NotAllowedError" });
    Object.defineProperty(navigator, "credentials", { configurable: true, value: { create: vi.fn().mockRejectedValue(err), get: vi.fn() } });
    try {
      const user = await open("#/passkey");
      await click(user, "Get registration options");
      await click(user, "Create the passkey");
      expect(await screen.findByTestId("passkey-error")).toHaveTextContent("NotAllowedError: The operation either timed out");
    } finally { delete navigator.credentials; }
  });
});

describe("webauthn helpers", () => {
  const win = (over = {}) => ({ PublicKeyCredential: function P() {}, navigator: { credentials: { create() {} } }, isSecureContext: true, location: { hostname: "localhost", port: "6171" }, ...over });
  it("browserPasskeySupport refuses an IP host (the RP ID trap), an insecure context and a browser without WebAuthn", () => {
    expect(browserPasskeySupport(win())).toEqual({ ok: true, reason: null });
    expect(browserPasskeySupport(win({ location: { hostname: "127.0.0.1", port: "6171" } })).reason).toMatch(/IP address.*http:\/\/localhost:6171\//);
    expect(browserPasskeySupport(win({ location: { hostname: "[::1]", port: "6171" } })).ok).toBe(false);
    expect(browserPasskeySupport(win({ isSecureContext: false })).reason).toMatch(/secure context/);
    expect(browserPasskeySupport(win({ PublicKeyCredential: undefined })).ok).toBe(false);
  });
  it("base64url round-trips, option conversion, credential JSON, and r||s -> DER", () => {
    const bytes = Uint8Array.from([0, 251, 255, 62, 63]);
    expect(b64u(bytes)).toBe("APv_Pj8");
    expect([...unb64u("APv_Pj8")]).toEqual([...bytes]);
    const c = toCreateOptions({ challenge: "AQID", user: { id: "BAU", name: "x" }, rp: { id: "localhost" } });
    expect([...c.challenge]).toEqual([1, 2, 3]); expect([...c.user.id]).toEqual([4, 5]); expect(c.excludeCredentials).toEqual([]);
    const g = toGetOptions({ challenge: "AQID", rpId: "localhost", allowCredentials: [{ type: "public-key", id: "BAU" }] });
    expect([...g.allowCredentials[0].id]).toEqual([4, 5]);
    const j = credentialToJSON({ id: "x", rawId: Uint8Array.of(1).buffer, type: "public-key", response: { clientDataJSON: Uint8Array.of(2).buffer, authenticatorData: Uint8Array.of(3).buffer, signature: Uint8Array.of(4).buffer, userHandle: null } });
    expect(j).toEqual({ id: "x", rawId: "AQ", type: "public-key", authenticatorAttachment: null, response: { clientDataJSON: "Ag", authenticatorData: "Aw", signature: "BA", userHandle: null } });
    const sig = new Uint8Array(64); sig[0] = 0x80; sig[63] = 1; // r has its high bit set (needs a 0 pad), s is mostly zeros (trimmed)
    const der = p1363ToDer(sig);
    expect([...der.slice(0, 5)]).toEqual([0x30, 33 + 2 + 1 + 2, 0x02, 33, 0x00]);
    expect([...der.slice(-3)]).toEqual([0x02, 1, 1]);
  });
});
