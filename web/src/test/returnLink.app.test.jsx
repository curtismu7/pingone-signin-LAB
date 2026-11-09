// Opened from Customer Agent LAB: the strip and the header Back button show; nothing is preselected.
import React from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { startFakeServer } from "./fakeServer.js";
import { returnLinkFor } from "../return-link/returnTargets.js";
import App from "../App.jsx";

const NOTE = { name: "Opened from Customer Agent LAB" };
let fake;
beforeAll(async () => { fake = await startFakeServer(); });
afterAll(() => fake.stop());
beforeEach(() => { fake.reset(); try { localStorage.clear(); } catch { /* none */ } });
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

describe("return link", () => {
  it("the vendored files match return-link.sha256, which names the parent commit", () => {
    const dir = path.join(process.cwd(), "src", "return-link");
    const text = fs.readFileSync(path.join(dir, "return-link.sha256"), "utf8");
    expect(text.split("\n")[0]).toMatch(/^# vendored byte for byte from curtismu7\/AI-DEMO-Standalone shared\/return-link at [0-9a-f]{7,40}/);
    const pins = text.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(/\s+/));
    expect(pins.map(([, f]) => f).sort()).toEqual(["ReturnLink.jsx", "ReturnLink.test.jsx", "returnTargets.js"]);
    for (const [h, f] of pins) expect(createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex"), f).toBe(h);
  });

  it("?from=customer-agent: banner first, strip right below, header Back in the tools", async () => {
    window.history.replaceState(null, "", "/?from=customer-agent&uc=UC-LOGIN&vertical=banking#/signin");
    render(<App />);
    await screen.findByRole("tablist");
    const note = screen.getByRole("note", NOTE);
    expect(note.textContent).toContain("UC-LOGIN");
    expect(screen.getByTestId("banner").nextElementSibling).toBe(note);
    expect(document.querySelector(".tools-right > button.return-link--header")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: /Back to Customer Agent LAB/ })).toHaveLength(2);
  });

  it("no from, an unknown from or a bad id: no strip, no button", async () => {
    for (const q of ["/", "/?from=elsewhere&uc=UC-LOGIN", "/?from=customer-agent&uc=%3Cb%3E", "/?from=customer-agent&uc=UC-LOGIN&vertical=a%20b"]) {
      window.history.replaceState(null, "", `${q}#/signin`);
      render(<App />);
      await screen.findByRole("tablist");
      expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
      expect(screen.queryByRole("note", NOTE)).toBeNull();
      cleanup();
    }
  });

  it("Back goes to the proxy path behind the lab proxy, to the direct URL on the app's own port", () => {
    window.history.replaceState(null, "", "/pingone-signin-lab/?from=customer-agent&uc=UC-LEARN16");
    expect(returnLinkFor("pingone-signin").href).toBe("/customer-agent/?returned=pingone-signin&uc=UC-LEARN16");
    window.history.replaceState(null, "", "/?from=customer-agent&uc=UC-LEARN16");
    expect(returnLinkFor("pingone-signin").href).toBe("http://127.0.0.1:5603/?returned=pingone-signin&uc=UC-LEARN16");
  });
});
