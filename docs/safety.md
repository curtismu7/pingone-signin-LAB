# Safety

- Binds `127.0.0.1` only. Another address needs `SIGNIN_BIND` set on purpose; the doctor reports it.
- Host header must be a loopback name on every route (DNS rebinding). Writes must be same-origin: a cross-origin `Origin` or a cross-site `Sec-Fetch-Site` gets 403, on `/api` and on `/mock`. A client with no `Origin` (curl) is allowed.
- Zero real outbound: `netguard` refuses non-loopback sockets, DNS (lookup, resolve*, reverse lookupService), fetch, UDP send and UDP connect. The server starts it first; `npm run doctor` and the tests prove it blocks. The mock OP runs in process, so nothing here has a reason to leave the machine.
- Every host in every story, seed and doc is `.invalid`, `.example`, or the apex of example.com/net/org (or loopback). The doctor, `GET /api/safety-scan` and the repo test scan for anything else.
- Tokens are HS256 with 32 random bytes made at process start (no key pairs). They name an `.example` issuer, carry `"mock": true`, and verify only against the in-process server. Reset mints a new key. Raw tokens are shown on purpose, for teaching.
- Passwords are masked (`********`) and cookie values shortened in every trace.
- Echoed input is made inert: control and bidi characters become visible escapes.
- Login is pi.flow only; a test pins that the authorize endpoint refuses anything else and that no source file issues a redirect.
- Ports 6100-6199 only.
- Settings come only from the one shared file (`~/Development/.env`, or `STANDALONE_ENV`), and only this lab's three keys are taken from it (`server/src/settings.js`). There is no per-app `.env` loader, no admin credential and no secret in this lab.
- Docker publishes `127.0.0.1` only, with a read-only filesystem, no capabilities, no new privileges and a non-root user; a test pins it.
- Live mode does not exist here. The header's Live button is refused with a message and the page stays in Mock.
- gitleaks runs as a pre-commit hook (`.githooks/pre-commit`, set up by `npm install`).
- The web UI talks only to its own origin (`/api`, `/mock`). The server sends a Content-Security-Policy with the page (`default-src 'self'`, `connect-src 'self'`, no framing). Text from the server or typed by the user is rendered as React text nodes only; control and bidi characters become visible `[U+XXXX]` chips. The UI never uses `innerHTML`, never navigates to an authorize URL and has no redirect-login control; a repo test pins that.
- The session-token cookie is HttpOnly. For the trace, the server also sends `X-Mock-Cookie-Preview`: the first 6 characters of the value and `...`, nothing more.
