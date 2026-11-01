import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App.jsx";

export async function open(hash = "#/signin") {
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("tablist");
  return user;
}
export const status = () => screen.getByTestId("flow-status").textContent;
// Action buttons are aria-disabled (still focusable), never natively disabled, so "enabled" means the attribute is absent.
export const enabled = (name) => waitFor(() => { const b = screen.getByRole("button", { name }); expect(b).not.toHaveAttribute("aria-disabled", "true"); return b; });
