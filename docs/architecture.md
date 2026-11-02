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
  password ok, no MFA            -> COMPLETED (+ resumeUrl)
  password ok, MFA, >1 device    -> DEVICE_SELECTION_REQUIRED -> OTP_REQUIRED -> COMPLETED
  password ok, MFA, 1 device     -> OTP_REQUIRED -> COMPLETED
  GET /as/resume (current cookie) on a COMPLETED flow -> { authorizeResponse: { code, state } }; the flow is then spent
  too many wrong OTPs / no device for a demanded acr -> FAILED
```

COMPLETED means the sign-in is done; the code is fetched in a separate call to `resumeUrl`. A flow that was resumed is single use: any later flow or resume call is `400 FLOW_ALREADY_COMPLETED`.

### Shapes shared with pingone-LAB, and what is only this lab's

This lab teaches how a sign-in behaves. For the real PingOne shapes and live use, see `pingone-LAB` (http://127.0.0.1:5500). The mock here uses the same pi.flow shapes that pingone-LAB's mock uses, which the owner saw on a real PingOne run on 2026-10-30:

| Shape | Source |
|---|---|
| A good password ends in status `COMPLETED`; the code comes from a separate `GET /as/resume?flowId=` | Seen on the real run (pingone-LAB) |
| A wrong password is `400` with `details[].code` = `INVALID_CREDENTIALS`, and the flow keeps waiting | Seen on the real run (pingone-LAB) |
| `USERNAME_PASSWORD_REQUIRED` as the first status; the `ST` cookie; the `application/vnd.pingidentity.usernamePassword.check+json` content type | Seen on the real run (pingone-LAB) |
| `SIGN_ON_REQUIRED` (identifier-first policy, username posted first as `user.lookup`) | A real status name, but **not driven by this lab** and its use is UNVERIFIED; pingone-LAB drives it |
| `{ authorizeResponse: { code, state } }` as the resume body | pingone-LAB's mock shape. **UNVERIFIED**: a real PingOne may answer with a redirect instead |
| Top-level `code: INVALID_DATA` around the `INVALID_CREDENTIALS` detail | pingone-LAB's mock; the real top-level code is **UNVERIFIED** |

**Lab inventions (UNVERIFIED, no PingOne counterpart claimed):** the lockout rule (3 failures, 300 s), the one-time passcode `424242`, the `ST` cookie rotating on every step and its `401 INVALID_SESSION_TOKEN`, `DEVICE_SELECTION_REQUIRED` and `OTP_REQUIRED` as a fixed MFA path, the `mock:single` and `mock:multi` acr names, the step-up demand, the CIBA mock phone (`/phone/*`) and the 8 character `binding_message` limit. The paths `/mock/authorize`, `/mock/flows/{id}`, `/mock/token` are this lab's mount points; only the `as/resume` segment follows PingOne's naming.

MFA is demanded when the user is flagged `mfa` or `acr_values` does not include `mock:single`. The session-token cookie `ST` is replaced on every handled step (a lab invention); a flow call with an old or missing cookie is `401 INVALID_SESSION_TOKEN` and does not burn the flow. A flow id must match `^[A-Za-z0-9_-]{6,64}$`.

## Mock versus real

| Topic | In this mock | Status against a real PingOne |
|---|---|---|
| pi.flow shape: authorize JSON, `/flows/{id}`, vendor content types, `COMPLETED`, `GET /as/resume`, `INVALID_CREDENTIALS` | as described above | The listed names were seen on a real PingOne run (pingone-LAB, 2026-10-30); the rest of the shape is modelled on the public sample apps and **not verified** here |
| Session-token cookie rotates per step and is required on resume | yes (lab invention) | The cookie name `ST` was seen on the real run; rotation per step and the `401` for an old cookie are **UNVERIFIED** |
| `/flows/{id}` needs a worker Bearer token | the mock does **not** require one | **UNVERIFIED** whether it does; do not rely on either |
| `/as/resume` response | `200` JSON `{ authorizeResponse: { code, state } }` | The call itself was seen on the real run; the JSON body is pingone-LAB's mock shape and **UNVERIFIED**, a real one may redirect |
| Status names | USERNAME_PASSWORD_REQUIRED, DEVICE_SELECTION_REQUIRED, OTP_REQUIRED, COMPLETED | USERNAME_PASSWORD_REQUIRED and COMPLETED were seen on the real run. DEVICE_SELECTION_REQUIRED and OTP_REQUIRED are names AI-DEMO2's driver handles, not seen live, and their order here is a lab invention (**UNVERIFIED**). SIGN_ON_REQUIRED and the other statuses (policy screens, external IdP) are not driven here. `RESUME_REQUIRED` and `MFA_REQUIRED` are not used |
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
