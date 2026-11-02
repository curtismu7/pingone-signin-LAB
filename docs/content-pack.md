# Content pack

`content-pack.json` (schema `demo-content-pack/1`, copied from the intent-par-inspector kit copy) is generated: `node scripts/build-content-pack.mjs`, checked by `npm run content-pack`.
Stories come straight from `server/data/scenarios.json` (id, title, takeaway), so the pack cannot drift from the scenarios; a test pins that.

- Glossary: pi.flow versus redirect login, flow statuses, the session-token cookie and its rotation, PKCE, acr/amr, auth_time and max_age, step-up (RFC 9470), CIBA, binding_message and the mock phone. Every name the mock invented (acr strings, the MFA status order, the cookie rotation, the lockout rule, the 8 character binding limit, the `authorizeResponse` answer of `/as/resume`) is labelled mock or UNVERIFIED in its definition, as the UI labels it. The shapes shared with pingone-LAB (`COMPLETED`, `GET /as/resume`, `INVALID_CREDENTIALS`) say so.
- Cards link to the UI tabs (`/#/signin`, `/#/stepup`, `/#/ciba`, `/#/scenarios`, `/#/diagram`) and to `/api/health`. Diagrams point at the Diagram tab with a `mode` of `login`, `stepup` or `ciba`; each entry's `id` is the name of its data file in `server/data/diagrams/` (the pack schema has no field for a file, so the id carries it; a repo test pins it).
- Sources are marked `not-read`: the RFC and OpenID links are cited from standard knowledge, not re-read for this pack. The catalog id is `A11` (pi.flow native sign-in kit) from `standalone-demo-family-plan.md` (checked 2026-10-21). `A5` (step-up) and `A4` (CIBA stations) are real catalog rows with this lab as their home (owner decision): the schema allows one catalog id, so those two are in `demo.tags` as `catalog-A4` and `catalog-A5`.
- The talk track is `docs/talk-track.md`.
