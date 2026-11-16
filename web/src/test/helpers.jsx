import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App.jsx";
import { setJsonView } from "../components/JsonPane.jsx";

export async function open(hash = "#/signin") {
  setJsonView("form"); // the Form | JSON choice is shared module state: every test starts in Form and says so when it needs JSON
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("reset-note"); // the lab has loaded (the shell bar is there while loading too)
  return user;
}
export const status = () => screen.getByTestId("flow-status").textContent;
// Action buttons are aria-disabled (still focusable), never natively disabled, so "enabled" means the attribute is absent.
export const enabled = (name) => waitFor(() => { const b = screen.getByRole("button", { name }); expect(b).not.toHaveAttribute("aria-disabled", "true"); return b; });
// One claim of a decoded token, in the Form view of its JSON pane: the row holds the claim's name and its value.
export const claim = (tokens, name, label = "id_token claims") => within(within(tokens).getByLabelText(label)).getByText(name, { selector: "dt" }).closest(".jform__row");
