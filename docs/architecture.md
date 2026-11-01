# Architecture

```
core/ (pure)                         server/ (Express)
  op.js      mock PingOne FSM  <---    app.js     /mock/*  -> op.handle(...)
  driver.js  PiFlowDriver, CibaDriver  runner.js  scenario -> fresh in-process op + injected clock -> trace
  transport.js  in-process fetchLike   scenarios.js  one function per slug; data in data/scenarios.json
  stepup.js  RFC 9470 helpers          doctor.js, safety.js, netguard.js, health.js
  jwt.js     HS256 mock tokens
```

`op.handle({method, path, query, headers, body, baseUrl})` returns `{status, headers, body}`. The server translates Express requests to that call; the runner calls it through `createInProcessFetch`, so the driver code a BFF would run is the same code the scenarios run. Time comes from an injected `now()`; scenarios use a fake clock, the live server uses the real one.

## Flow state machine

```
authorize(pi.flow) -> USERNAME_PASSWORD_REQUIRED
  password ok, no MFA            -> RESUME_REQUIRED
  password ok, MFA, >1 device    -> DEVICE_SELECTION_REQUIRED -> OTP_REQUIRED -> RESUME_REQUIRED
  password ok, MFA, 1 device     -> OTP_REQUIRED -> RESUME_REQUIRED
  resume (current cookie)        -> COMPLETED (+ code)
  too many wrong OTPs / no device for a demanded acr -> FAILED
```

MFA is demanded when the user is flagged `mfa` or `acr_values` does not include `mock:single`. The session-token cookie `ST` is replaced on every handled step; a flow call with an old or missing cookie is `401 INVALID_SESSION_TOKEN` and does not burn the flow. A flow id must match `^[A-Za-z0-9_-]{6,64}$`.

## Mock versus real

| Topic | In this mock | Status against a real PingOne |
|---|---|---|
| pi.flow shape (authorize JSON, `/flows/{id}`, vendor content types, `/resume`, `/token`) | as described above | Modelled on the public sample apps; details **not verified** here |
| Session-token cookie rotates per step and is required on resume | yes | Documented by the seed driver; exact cookie names and rotation points **UNVERIFIED** |
| `/flows/{id}` needs a worker Bearer token | the mock does **not** require one | **UNVERIFIED** whether it does; do not rely on either |
| `/resume` response | `200` JSON `{code, state, redirect_uri}` | **UNVERIFIED**; a real one may redirect |
| Status names | USERNAME_PASSWORD_REQUIRED, DEVICE_SELECTION_REQUIRED, OTP_REQUIRED, RESUME_REQUIRED, COMPLETED | Real names and the extra statuses (policy screens, external IdP) **UNVERIFIED**; MFA_REQUIRED is not used |
| acr strings | `mock:single`, `mock:multi` (fictional) | Which acr strings a real PingOne issues is **UNVERIFIED** |
| Step-up (RFC 9470) | resource server mock issues the challenge | The RFC is the standard; PingOne support for it is **UNVERIFIED** |
| Authentication age | every authorize is a fresh login (no SSO session), so `max_age` is validated and satisfied by the new login | Real SSO-session behaviour not modelled |
| CIBA | `bc-authorize`, polling errors, `binding_message` <= 8 characters | The 8-character limit is a mock value; real limits **UNVERIFIED** |
| Tokens | HS256, throwaway key, `"mock": true` | Real tokens are asymmetric and come from a real issuer |
| Lockout | per username (not per flow), 3 failures, 300 s, counted even for unknown names; the table is capped at 1000 names and evicts the oldest | Real policy is configurable and differs |
| One-time passcode attempts | counted per flow (3); a new flow starts the count again, so the OTP limit is a per-flow limit, not a per-user lockout | Real behaviour **UNVERIFIED** |

## Deliberate departures

- PKCE, state and nonce are **required** (the sample apps this was studied from send none of them).
- A code is burned on its first exchange, right or wrong.
- Unknown users get the same error as a wrong password.
- Query and body parameters must be single strings: a repeated or nested parameter (`scope[]=openid`) is refused, so nothing is coerced into a different value.
- `handle()` never throws; a malformed percent-escape in a flow path is `400 INVALID_FLOW_ID`.

## Web UI

`web/` is a React + Vite single page. It uses the same wire protocol as the core `PiFlowDriver` but implements it again for the browser (`web/src/lib/flow.js`, WebCrypto PKCE) because the core imports `node:crypto`. The page plays the BFF: it keeps the verifier and relies on the browser's cookie jar for `ST` (HttpOnly). Because a page cannot read `Set-Cookie`, the mock router adds `X-Mock-Cookie-Preview` (shortened, ASCII) and the trace pane shows that. Every call goes through one tracer that records `{n, title, request, response, note}`, the same shape the server's scenario runner returns, so the same `TraceList` renders live traces and scenario traces.

State lives in hooks in `App.jsx` (one per tab), so switching tabs keeps a login, a step-up or a CIBA request in progress. The diagram is built from the data files in `server/data/diagrams/` (see `diagrams.md`) and draws edges per exchange (a request and its answer share a line) with numbered labels and a step list below, because several exchanges join the same two boxes.

| Topic | Status |
|---|---|
| The `X-Mock-Cookie-Preview` header, the `/phone/*` endpoints, the +5 s `slow_down` step | Invented by this lab; no PingOne counterpart is claimed |
| A real PingOne's behaviour for anything the UI labels mock or UNVERIFIED | Not checked here |
