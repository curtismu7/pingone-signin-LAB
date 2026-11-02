# Changelog

## Unreleased: sharper scope and the real pi.flow shapes

This lab and `pingone-LAB` stay separate (owner decision): this one teaches how a PingOne-style sign-in behaves (failures, lockout, replay, MFA, step-up, CIBA with a mock phone), mock only; `pingone-LAB` holds the real PingOne shapes and live use.

- README, `CLAUDE.md`, the content pack and the shelf entry state the sharper scope and point at `pingone-LAB`. `A5` (Step-up auth) and `A4` (CIBA lab) are real catalog rows with this lab as their home; A11 stays the catalog id.
- The mock's shared pi.flow shapes now match the ones `pingone-LAB` saw on a real PingOne run: a good password ends in `COMPLETED` (the invented `RESUME_REQUIRED` is gone), the code comes from `GET /as/resume?flowId=` (was `/resume`) as `{ authorizeResponse: { code, state } }`, and a wrong password is a `400` with `details[].code` `INVALID_CREDENTIALS`. The lockout rule, passcode 424242, cookie rotation, acr names, step-up demand and CIBA phone are unchanged and labelled lab inventions in `docs/architecture.md` and the UI trace.
- The Live refusal names `pingone-LAB`. The Resume button is now `Resume (GET /as/resume)` and stays disabled until the flow is `COMPLETED`.
- `docs/shelf-entry.json` is one flat object in the committed shelf format (it was wrapped in a `demos` array); a test pins the description to 300 characters or fewer.
- Tests: 54 core (one added), 75 server, 76 web, 39 repo checks (one added), 24 e2e.

## 0.1.0 (2026-11-01): first -LAB release

Moved from the older private repo to the `-LAB` standard, with one clean commit and no old history. No new features.

- Docker only: the SE k8s build is gone (manifests, deploy script, hosted mode, the `MODE` switch and their tests and docs).
- Node 26 only (engines, `.nvmrc`, Dockerfile `node:26-alpine`); CI on GitHub-hosted runners.
- The shared stylesheet is vendored and the app CSS is on its tokens (no colour literals, no dark-mode query, no forced priority).
- Header on every page with a Mock | Live toggle (Live is refused with a message: the lab has no live mode), the mode, and the simulation banner.
- Presenter mode on P and Esc (modifier keys ignored). Action buttons use `aria-disabled` so they keep focus; the `main` landmark is kept.
- The talk track is generated from `server/data/talk-track.json`, with a drift test.
- Settings come from the one shared `~/Development/.env` (this lab's keys only); no per-app `.env` loader.
- The netguard also guards `dgram` connect, with a self-test.
- README on the 12-section standard; `CLAUDE.md`, `.env.example`, shelf entry and content pack updated.

The mock engine, the 16 scenarios and three verticals, the three diagram-studio/1 flows, step-up and CIBA are unchanged.
