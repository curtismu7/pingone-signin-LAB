# PingOne Sign-in LAB

A lab that teaches how a PingOne-style **pi.flow** sign-in *behaves*: wrong passwords, lockout, replay, a rotating session-token cookie, MFA, step-up (RFC 9470) and CIBA with a mock phone. It is mock only and a **simulation of behaviour**, not a copy of PingOne. For the real PingOne shapes and live use, see `pingone-LAB` (`ping-sandbox/pingone-LAB`, http://127.0.0.1:5500).

Tier: Demo
Repo: https://github.com/ping-sandbox/pingone-signin-LAB
Catalog: A11

Catalog note: `A11` (the pi.flow native sign-in kit) is this lab's catalog id. `A5` (Step-up auth, RFC 9470) and `A4` (CIBA lab) are real catalog rows with this lab as their home (owner decision); they are also listed as tags in the content pack. This build did not re-check the rows against a published catalog.

## What is simulated

**Mock mode (the only mode).** Everything here is fictional and runs offline in one process: the users, passwords, one-time passcodes, client ids, acr names (`mock:single`, `mock:multi`), flow status names, the 8 character `binding_message` limit and the token key (made fresh at every process start). The mock PingOne, the resource server and the mock phone are in-process. No tenant, no credentials, no outbound network (a netguard refuses it and proves that at start-up). What a real PingOne does behind these steps (whether `/flows/{id}` needs a worker Bearer, what `/as/resume` answers on the wire, the real binding-message limit, the real acr strings) is **UNVERIFIED** here; see `docs/architecture.md`.

**Live mode does not exist in this lab.** The Live button in the header is refused with a message that points to `pingone-LAB`, and the page stays in Mock. `pingone-LAB` (http://127.0.0.1:5500) is the lab that covers protocol coverage and can talk to a real tenant, owner-run.

**Real shapes versus lab inventions.** The shared pi.flow shapes follow what the owner saw on a real PingOne run on 2026-10-30 (recorded in `pingone-LAB`): a good password ends in the status `COMPLETED`, the code is fetched by `GET /as/resume?flowId=`, and a wrong password is a `400` with `details[].code` `INVALID_CREDENTIALS`. Everything else here is this lab's own invention and labelled as such in the UI trace and in `docs/architecture.md`: the lockout rule, the passcode `424242`, the cookie rotating on every step, the `mock:single` and `mock:multi` acr names, the step-up demand and the CIBA mock phone.

The banner above every tab says the same, also in presenter mode.

### What it shows

1. `GET /mock/authorize` with `response_mode=pi.flow` (PKCE S256, state, nonce) answers with JSON, not a redirect: a flow `{id, status: USERNAME_PASSWORD_REQUIRED, _links}` and a session-token cookie `ST`.
2. `POST /mock/flows/{id}` with a `vnd.pingidentity` content type checks the password (then, when the user or the requested acr demands it, a device and a one-time passcode). The cookie **rotates on every step**.
3. The status is now `COMPLETED`; this lab also adds a `resumeUrl` link to the flow (a lab detail, UNVERIFIED against PingOne). `GET /mock/as/resume?flowId=` needs the **current** cookie (a lab rule) and answers `{ authorizeResponse: { code, state } }`, with a code bound to the PKCE challenge.
4. `POST /mock/token` swaps code + verifier for HS256-signed `id_token` / `access_token` carrying `acr`, `amr`, `auth_time`, `sub`, `nonce`.
5. Step-up (RFC 9470): the mock resource server answers `401 WWW-Authenticate: Bearer error="insufficient_user_authentication", acr_values=..., max_age=...`; re-authorizing with those values forces MFA and a fresh `auth_time`.
6. CIBA: `POST /mock/bc-authorize`, poll `POST /mock/token`, and a mock phone that approves or denies.

Login is pi.flow **only**. An authorize request without `response_mode=pi.flow` is refused with an error and no flow or cookie; there is no redirect-based login path anywhere. In this lab the page plays the BFF (it holds the PKCE verifier and sends the cookie); a real application would keep those on a server.

### The UI, tab by tab

1. **Sign in**: open a pi.flow (optionally asking for a mock acr), then fill in the form the flow's status asks for, then Resume and Exchange. The trace shows every request and response; passwords are `********` and the session-token cookie is shown only as the server's shortened preview. The decoded id_token marks `acr`, `amr`, `auth_time` and `nonce`.
2. **Step-up**: sign in with a low acr, call `POST /mock/rs/transfer`, read the parsed 401 challenge, re-authorize with the challenge's `acr_values` (and `max_age`), retry and get 200.
3. **CIBA**: `login_hint`, a `binding_message` with a live counter against the mock's 8 character limit, an optional `requested_expiry`. The MOCK PHONE shows the notification with Approve and Deny. Polling shows `authorization_pending`, `slow_down`, `access_denied`, `expired_token` or the tokens.
4. **Scenarios**: the server's 16 scenarios (`S01`-`S16`), Run and Run all, pass/fail, expected versus actual, trace, and a vertical picker in the header.
5. **Diagram**: browser, BFF, mock PingOne, resource server and mock phone, as ReactFlow drawn from diagram-studio/1 data files (`server/data/diagrams/`, served at `/api/diagrams/:id`; see `docs/diagrams.md`). Pick the login, step-up or CIBA flow, Simulate, drag boxes, change the speed (0.5x to 4x), Reset (the boxes go back).
6. **Raw**: every message as HTTP text.
7. **Talk track**: `docs/talk-track.md`, generated from `server/data/talk-track.json` (`npm run talk-track`; a test fails on drift).

**Presenter mode** (the Present button, or P; Esc leaves it; Ctrl, Cmd and Alt combinations are ignored, and so is typing in a field): large text, the Raw tab, the trace panes and the raw tokens are hidden, the simulation banner stays, and on the Diagram tab the Right and Left arrow keys (or Page Down and Page Up) step through the flow.

**Workspace id**: `SIGNIN_WORKSPACE` (default `default`, must match `[a-z0-9-]{1,32}`). One server process is one workspace: its mock state (flows, codes, CIBA requests, lockouts, token key), its data directory (`SIGNIN_DATA_DIR/<id>/`, only when set) and its trace sink (`GET /api/trace`, the last 500 hops) are private to it; a request cannot choose the workspace (`GET /api/workspace` names it).

**Three vertical packs**: travel, banking and healthcare, all fictional (the cast is in `core/src/seed.js`, the words in `server/data/verticals.json`). Stories are data with `{{cast.<role>}}` and `{{vocab.<key>}}` tokens; a test fails on any token that is not defined in every vertical.

**customer.config.json** (git-ignored; copy `customer.config.example.json`): `name`, default `vertical`, `vocabulary` overrides and `brand.primary` (and optional `primaryDark`). It is validated and capped (file at most 64 KB, 50 vocabulary words, nesting at most 6 levels; unknown fields, credential-looking keys, markup, purple hues and low contrast are refused) and applied as CSS tokens. `SIGNIN_CUSTOMER_CONFIG` points elsewhere. `GET /api/customer-config` shows the sanitized result.

**traceparent**: every request the page, the in-process driver and the scenario runner make carries a W3C `traceparent`; the mock answers with the same trace id and a new span id.

### The 16 scenarios

Each runs against three verticals (travel with Mark, Dana, Priya; banking with Alice, Ravi, Noah; healthcare with Lena, Omar, Sana): happy path, wrong password then success, lockout, stale-cookie resume, expired flow, replayed code, wrong PKCE verifier, redirect login refused, step-up on low acr, stale `auth_time` with `max_age`, CIBA approve / deny / expire / slow_down / binding message too long, and an MFA login with device selection.

## Run from a clone

Prerequisites: Node 26 or newer. Docker only if you use the Docker form. Mock mode needs no setup at all: no tenant, no credentials, no settings file.

```
git clone https://github.com/ping-sandbox/pingone-signin-LAB.git
cd pingone-signin-LAB
npm ci
npm run build         # builds web/dist, which the server serves at /
npm run doctor        # preflight (optional)
npm start
```

Open http://localhost:6171/ (the mock PingOne is at http://127.0.0.1:6171/mock/ and the API at http://127.0.0.1:6171/api/). `./scripts/run.sh` does install, doctor and start in one command. Without `npm run build` the server still runs: `/` is a 404 and the doctor says `web/dist is not built`.

UI development: `npm start` in one terminal, `npm run dev -w web` in another, then open http://localhost:6173/ (Vite proxies `/api` and `/mock` to the server).

```
curl -s http://127.0.0.1:6171/api/health
curl -s 'http://127.0.0.1:6171/api/catalog?vertical=travel'
curl -s -X POST http://127.0.0.1:6171/api/run -H 'content-type: application/json' -d '{"scenario":"step-up-low-acr","vertical":"travel"}'
curl -s -X POST http://127.0.0.1:6171/api/run-all -H 'content-type: application/json' -d '{"vertical":"banking"}'
curl -s http://127.0.0.1:6171/api/safety-scan
```

`POST /api/run` returns `{pass, expected, actual, trace}`. Open a flow by hand (the PKCE challenge below is the S256 of 43 letter `v`, the verifier is `vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv`):

```
curl -si 'http://127.0.0.1:6171/mock/authorize?client_id=lab-app&redirect_uri=https://app.lab.example/callback&response_type=code&scope=openid&response_mode=pi.flow&code_challenge=7w_YNF9DSfIdPf_pRjSq646_kPr-2-o9NAl16JGghdM&code_challenge_method=S256&state=s1&nonce=n1'
# same URL without response_mode=pi.flow -> 400 invalid_request, no cookie
```

Then `POST` the `_links.self.href` with `-H 'content-type: application/vnd.pingidentity.usernamePassword.check+json' -H 'cookie: ST=<value>' -d '{"username":"mark","password":"mock-password"}'`. The seeded mock values (password `mock-password`, one-time passcode `424242`) are in `GET /api/catalog`; every request and response is written out in `docs/api-examples.md`.

## Settings file

All standalone apps read one settings file, `~/Development/.env` (mode 600); set `STANDALONE_ENV` to use another path. This lab takes only these keys from it, all optional, and ignores everything else:

- `SIGNIN_WORKSPACE`: the workspace id (default `default`).
- `SIGNIN_DATA_DIR`: persist the trace sink as `<dir>/<workspace>/trace.jsonl` (default: memory only).
- `SIGNIN_CUSTOMER_CONFIG`: path to another `customer.config.json`.

The lab holds no tenant setting, no credential and no secret. `PORT` and `SIGNIN_BIND` are per-run settings from the shell, not the shared file. There is no per-app `.env` loader. See `.env.example`.

## Ports, and what to do if the port is taken

Ports: PingOne Sign-in LAB listens on 6171 (set with `PORT`, default 6171). The Vite dev server uses 6173 (`VITE_PORT`), Docker publishes `HOST_PORT` (default 6171), and the e2e run takes the first free port in 6173-6199 (`E2E_PORT` to choose one).
Port range for this app: 6100-6199.

If the port is taken:
1. Find what is using it:
   `lsof -iTCP:6171 -sTCP:LISTEN -n -P`
2. If it is an old copy of this app, stop that process: `kill <PID>`.
3. If it is something else, stop it, or start this app on another port:
   `PORT=<other port in 6100-6199> npm start`
4. Do not use 8080, 5173, 3000, 4000, 4400, 4510, 4600-4601, 18080, 19080 or 19090.
   Those are taken by other demos or other tools.

## Mock and live modes

The header has a **Mock | Live** toggle on every page (also while the lab is loading), the mode (`MOCK: offline, no tenant`) beside the title, and the simulation banner above it. Mock is the default and the only mode: pressing **Live** shows an honest message (there is no live mode and no tenant connection) and leaves the page in Mock; pressing **Mock** clears it. Nothing else changes with the toggle.

## Health, doctor and reset

```
npm run doctor   # checks node, bind, port, workspace, customer.config, story tokens and hosts, netguard, pi.flow-only, all scenarios, web/dist, and that the port is free
npm run reset    # clears run state of a running lab (node scripts/reset.mjs [base-url], loopback only)
```

The app answers `GET /api/health` with `demo-health/1` (public, GET only, state from the doctor checks). `POST /api/reset` (same-origin writes only) forgets every flow, code, CIBA request and token, empties the trace sink and mints a new throwaway key; the UI's **Reset lab** button calls it and also clears every tab and puts the diagram boxes back.

## Docker (optional)

```
HOST_PORT=6171 docker compose up --build -d     # http://127.0.0.1:6171/api/health  (HOST_PORT must be in 6100-6199)
docker compose down
```

It publishes to 127.0.0.1 only (`scripts/compose.test.mjs` pins that). The server listens on all interfaces inside the container (`SIGNIN_BIND=0.0.0.0`, set in the Dockerfile on purpose); the container is read-only, runs as the non-root `node` user with no capabilities, and has a `demo-health/1` healthcheck. Docker on OrbStack, never Docker Desktop. The image is `node:26-alpine` and is not pushed anywhere.

## Tests

```
npm test        # core (node:test), server (node:test), web (vitest), repo checks (node:test)
npm run e2e     # builds web, then Playwright (real chromium) against a real server
```

On Node 26 a good `npm test` run is: 54 core, 75 server, 76 web (vitest, 10 files) and 39 repo-check tests, 0 failed. One repo check skips itself when the owner's local forbidden-strings list is absent (so hosted CI shows 1 skipped and a machine with the list shows 0). On a heavily loaded machine the web tests can time out; `WEB_ASYNC_TIMEOUT=20000 WEB_TEST_TIMEOUT=90000 npm test` raises the limits. `npm run e2e` needs Playwright's chromium (`npx playwright install chromium` once) and covers login, MFA, lockout, step-up, CIBA, scenarios, the diagram, light and dark, a 390 px viewport, presenter mode and its keys, the Mock | Live toggle, `traceparent` and a tour of every tab. Chrome logs every deliberate 4xx fetch as a console error, so tests that refuse on purpose ignore those lines.

## Troubleshooting

- **Port is taken**: see the ports section above.
- **`/` is a 404**: run `npm run build` once; the API and the mock work without it.
- **`npm start` refuses to start**: it prints the failed doctor check; run `npm run doctor` and fix that line (Node below 26 and a port outside 6100-6199 are the usual ones).
- **Live is refused**: by design. This lab has no live mode.
- **`npm ci` times out in Docker on OrbStack**: the Dockerfile already lets Node fall back to IPv4; retry the build.

## Ownership

- Owner: the Ping demo family owner (Demo tier).
- License: MIT (see `LICENSE`).
- Found a problem? Open an issue on the repo.
- Related, kept separate (owner decision): `pingone-LAB` (ports 5500-5549, http://127.0.0.1:5500) covers PingOne protocol coverage with real shapes and a live mode. This lab covers sign-in behaviour: failures, lockout, replay, MFA, step-up and CIBA with a mock phone, mock only.
