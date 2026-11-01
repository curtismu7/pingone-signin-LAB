# Talk track (about eight minutes in the terminal; the same story in the UI is below)

1. `npm run doctor`, then `npm start`. Say: offline, loopback, nothing leaves the machine.
2. `curl` the authorize URL from the README **without** `response_mode=pi.flow`: refused, no cookie. Then with it: JSON and a cookie. Point out there is no browser redirect.
3. `POST /api/run {"scenario":"happy-path"}`: four calls. Read the trace titles and notes.
4. `stale-cookie-resume`: the cookie changes at every step; an old one cannot resume.
5. `wrong-verifier` and `replayed-code`: the code is bound to PKCE and single use.
6. `step-up-low-acr`: 401 with the RFC 9470 challenge, re-authorize with `acr_values`, 200. The acr names are mock.
7. `ciba-approve`, `ciba-slow-down`, `ciba-binding-too-long`: backchannel in three stories.
8. `POST /api/run-all`: everything behaves as written. `POST /api/reset` to start clean.

## In the UI (http://localhost:6171/)

1. Point at the header: `MOCK: offline, no tenant`, and the Mock | Live toggle (Live is refused here: there is no tenant behind this lab). Open **Sign in**, press Open the flow, sign in as mark (Use fills the form), then Resume and Exchange. Watch the trace: JSON not a redirect, and the cookie preview changes at every step. Read `acr`, `amr`, `auth_time` and the nonce match.
2. Wrong password once, then lockout with dana: the attempt counter and `ACCOUNT_LOCKED`.
3. **Step-up**: low acr, the 401 challenge parsed on screen, re-authorize, retry 200. The acr names are mock.
4. **CIBA**: type a binding message and watch the counter (8 is a mock limit). Approve on the mock phone and poll; then deny; press Poll now twice for `slow_down`.
5. **Scenarios**: Run all, 16 of 16. **Diagram**: Simulate the three flows at 2x, drag a box, Reset.
6. Light and dark, then Reset lab. Press P for presenter mode (Esc leaves it; the simulation banner stays).
