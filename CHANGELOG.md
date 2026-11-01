# Changelog

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
