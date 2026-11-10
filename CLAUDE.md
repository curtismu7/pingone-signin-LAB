# PingOne Sign-in LAB (CLAUDE.md)

An offline lab (tier: Demo) that teaches how a PingOne-style **pi.flow** sign-in *behaves*: failures, lockout, replay, MFA, step-up (RFC 9470) and CIBA with a mock phone (catalog A11, with A5 and A4 as real rows homed here), 16 scenarios in three vertical packs, a ReactFlow diagram, presenter mode. Mock only and a **simulation of behaviour**: no tenant, no credentials, no outbound network, everything (users, passwords, OTP, acr names, tokens) fictional. The header's Live button is refused with a pointer to `pingone-LAB` (http://127.0.0.1:5500), which holds the real PingOne shapes and live use. Keep the shared pi.flow shapes (`COMPLETED`, `GET /as/resume`, `INVALID_CREDENTIALS`) aligned with that lab's mock.

## Run and test

- `npm ci`, `npm run build` (web/dist), `npm start` (UI + API + mock on http://127.0.0.1:6171/), `npm run doctor`, `npm run reset`, `npm run talk-track`, `npm run content-pack`. Docker (OrbStack): `HOST_PORT=6171 docker compose up --build -d`.
- `npm test` = core + server (node:test) + web (vitest) + repo checks. `npm run e2e` = Playwright/chromium against a real server on a free port in 6173-6199 (`npx playwright install chromium` once). Node 26 only. Layout: `core/` pure engine, `server/` Express + scenarios, `web/` React UI, `e2e/`, `scripts/`, `docs/`.
- Run `check-drift.sh`, `check-css.sh` and `demo-kit-base/scripts/conformance.mjs --new` by hand before a PR. The SE k8s build is deferred (owner, 2026-10-31): no k8s, no hosted mode, no `MODE` switch.

## Rules that bite

- **Login is pi.flow only.** No redirect login, no link to an authorize URL, no `.redirect(`/`location` header; tests pin it. The refused redirect login exists only as scenario S08.
- **Label the mock.** Anything this lab invented (acr `mock:single` / `mock:multi`, status order (the MFA path), the cookie rotating per step, the lockout rule, the 8 character `binding_message` limit, the `authorizeResponse` resume body, the +5 s `slow_down`, `/phone/*`) must show as "mock" or UNVERIFIED in the UI and docs. Never present it as a PingOne fact.
- The simulation banner (`MOCK: offline, no tenant`) is on every tab, also in presenter mode. The Mock | Live toggle and the mode are in the header on every page; Live is refused (no live mode exists).
- All server and user text renders inert (React text nodes; `Inert`). No `innerHTML`.
- Passkey tab: the mock WebAuthn RP is `core/src/webauthn.js` (`/mock/passkey/*`), ES256 only. Keys come from WebCrypto (page) or `createECDH` + `createPrivateKey` (tests). Real (PingOne FIDO2 via pi.flow) is not run here: it needs tenant setup (README). The RP ID trap (page domain, never an IP) is stated in the UI and README.
- Test scripts use globs: `node --test test/*.test.js`, never a directory. No EC `generateKeyPair` or `generateKeyPairSync` anywhere (tokens are HS256 with a throwaway key).
- Ports 6100-6199 only (server 6171, Vite 6173, e2e picks a free one). Loopback bind, Host check, same-origin writes, netguard (fetch, sockets, dns, udp send and connect, with a self-test); Docker publishes `127.0.0.1:` only (a test pins it).
- Settings: the one shared `~/Development/.env` (`STANDALONE_ENV` overrides), `server/src/settings.js`, this lab's three keys only. No per-app `.env` loader.
- Only `.invalid` / `.example` hosts anywhere. History scan `git log -p --all | grep -cF -f ~/.config/demo-kit/forbidden-strings.txt` must print 0 (never print the list); gitleaks hook runs on commit; CI has a forbidden-strings job.
- Stories are data (`server/data/*.json`) with `{{cast.<role>}}` and `{{vocab.<key>}}` tokens and three verticals; a test fails on an undefined token. The talk track is data too (`server/data/talk-track.json`); `docs/talk-track.md` is generated (`npm run talk-track`) and a test fails on drift.
- Workspace id (`SIGNIN_WORKSPACE`, default `default`, `[a-z0-9-]{1,32}`) keys the mock state, data dir and trace sink. `customer.config.json` (validated, no purple) re-skins via CSS tokens. Every hop carries a W3C `traceparent`.
- UI: the shared `web/src/styles/standalone-ui.css` is vendored byte for byte (never edit it); `web/src/app.css` uses tokens only. Action buttons use `aria-disabled` (the `Btn` component), not `disabled`. P toggles presenter mode, Esc leaves it (modifier keys ignored).
- No AI attribution anywhere (no `Co-Authored-By` trailer, no "Generated with" line). Never push or add a remote without the owner.

## Diagrams (rule 17)
The three flow diagrams are `diagram-studio/1` data in `server/data/diagrams/` (nodes, edges, groups, steps; positions = Reset positions). Do not hand-build nodes or edges in `DiagramTab.jsx`: edit the JSON. `server/src/vendor/diagram-validate.js` is vendored from the studio: never edit it (a test pins its hash; re-vendor per `docs/diagrams.md`). A dashed edge means one-way. Live highlighting and Simulate stay app code. Gap list for the studio: `docs/diagrams.md`.
