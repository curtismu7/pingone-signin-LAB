import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Inert, reveal } from "../lib/Inert.jsx";
import { decodeJwt } from "../lib/jwt.js";
import { newPkce } from "../lib/pkce.js";
import { Mock, Unverified } from "../components/ui.jsx";
import { createTracer, rawMessage } from "../lib/trace.js";

describe("Inert", () => {
  it("renders markup as text and control or bidi characters as visible chips", () => {
    const { container } = render(<Inert text={'<img src=x onerror=alert(1)>‮\u0007'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(container.textContent).toContain("[U+202E]");
    expect(container.textContent).toContain("[U+0007]");
    expect(reveal("plain")).toEqual([{ text: "plain" }]);
  });
});

describe("lib", () => {
  it("decodeJwt decodes a payload and returns null for junk", () => {
    const b = (o) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    expect(decodeJwt(`${b({ alg: "HS256" })}.${b({ acr: "mock:single", name: "Zoë" })}.sig`).payload.acr).toBe("mock:single");
    expect(decodeJwt("nope")).toBeNull();
    expect(decodeJwt(undefined)).toBeNull();
  });
  it("newPkce makes a 43 character S256 verifier/challenge pair", async () => {
    const p = await newPkce();
    expect(p.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.challenge).not.toBe(p.verifier);
  });
  it("the tracer masks passwords and survives a network failure", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("offline"); };
    try {
      const t = createTracer();
      const r = await t.call("x", { method: "POST", path: "/mock/flows/abc", headers: { "content-type": "application/vnd.pingidentity.usernamePassword.check+json" }, body: JSON.stringify({ username: "u", password: "hunter2" }) });
      expect(r.status).toBe(0);
      expect(t.entries[0].request.body).not.toContain("hunter2");
      expect(t.entries[0].request.body).toContain("********");
      expect(rawMessage(t.entries[0]).request).toContain("POST /mock/flows/abc HTTP/1.1");
    } finally { globalThis.fetch = real; }
  });

  it("the mock and UNVERIFIED badges explain themselves in their title text", () => {
    const { getByText } = render(<><Mock>mock acr name</Mock><Unverified /></>);
    expect(getByText("mock acr name")).toHaveAttribute("title", "Invented by this lab. Not a PingOne fact.");
    expect(getByText("UNVERIFIED")).toHaveAttribute("title", "Not checked against a real PingOne tenant.");
  });
});
