import React from "react";
// The simulation banner (rule 2): on every tab, also in presenter mode. This lab has one mode, Mock, so the banner always says it.
export default function Banner() {
  return (
    <div className="banner" role="note" data-state="mock" data-testid="banner">
      <strong>MOCK: offline, no tenant.</strong> Every user, password, passcode, acr name and token here is fictional and issued by this lab with a throwaway key. Nothing leaves this machine. This is a simulation of how a sign-in behaves, not a copy of PingOne. Login is pi.flow only. Live mode is not available in this lab.
    </div>
  );
}
