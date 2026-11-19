# Handoff: Mock iPhone in pingone-signin-LAB

Date: 2026-11-19
Repo: `curtismu7/pingone-signin-LAB`
Branch: **`chore/phone-app-dock`** — 3 commits, **PR #20 open, NOT merged**
Live at: `https://local.ping-devops.com:8443/pingone-signin-lab#/ciba` (container rebuilt from the branch, serving now)

## What was done

Turned the CIBA tab's mock phone from a plain rounded card into a mock iPhone, in three commits (all on the PR branch, in order):

1. **`b08bae2` — app dock.** Four iOS-style app tiles at the bottom of the phone screen: PingOne (Ping Red gradient), Authenticator (blue `--status-info`), Messages (green `--status-ok`), Settings (neutral). Labels under each glyph. Marked decorative (`aria-label="Phone apps (decorative)"`, per-tile `title`, `aria-hidden` glyphs) so no test or screen reader is affected.
2. **`4449ae1` — full iPhone chrome.** The dock alone didn't read as a phone. Now: tall dark bezel (300px wide, 44px corner radius, `--box-dark`), **Dynamic Island** pill, **status bar** (`9:41` + signal/wifi/battery glyphs), tall screen (min-height 420px) with the notification body vertically centred, **home indicator** under the dock. New structure in `CibaTab.jsx`: `.phone__screen` wraps `.phone__island` → `.phone__statusbar` → `.phone__body` (the existing notification/content markup) → `.phone__dock` → `.phone__homebar`.
3. **`757aafe` — dark screen, white text, both themes.** The screen fill is `--box-dark` with `--on-box` text in light AND dark theme (it always looks like a phone screen). `.muted`/`.small` inside the screen render white at 75% opacity; code chips and alerts use translucent white fills. Approve/Deny keep their existing accent/deny token colors.

## Files touched (only two)

- `web/src/app.css` — rewrote the `.phone*` block (lines ~97–124): bezel, island, statusbar, body, homebar, dock, media query at 900px (full-width phone centred, smaller tiles at 375px).
- `web/src/tabs/CibaTab.jsx` — `MockPhone` component: added the island/statusbar/homebar wrappers and the dock array; the Approve/Deny logic and testids (`phone`, `phone-notification`, `phone-binding`, `phone-result`, `phone-error`) are unchanged.

## Verification (all done on the branch)

- Web tests: **137/137 passed** (`cd web && npx vitest run`)
- Build: `npm run build` green
- `gitleaks` clean on every push (pre-commit hook)
- Browser-verified at the proxy URL, 0 console errors (one pre-existing 404 for `/favicon.ico` — unrelated):
  - idle state screenshot, notification state (started a request as `mark`/`dana`), light and dark themes
  - white-on-dark text confirmed in both themes

## Known state / gotchas

- **PR #20 is open, not merged.** Merge when ready; after merge, bump the meta-repo submodule pin (`AI-DEMO-Standalone`) and rebuild any running container from `main`.
- The browser console 404 for `/favicon.ico` predates this work.
- The dock tiles are intentionally non-interactive (no buttons). If someone later wants them clickable, they need real routes/actions first — do not add fake navigation.
- The status bar glyphs are plain text (`▮▮▮ wifi batt`), not an icon font — deliberate, no vendored icon dependency.
- The `.phone` block was rewritten, so any other tab that uses `.phone` markup would pick up the chrome too. As of this branch only `CibaTab.jsx` uses it (`grep -rn 'className="phone' web/src` to confirm before reusing).

## To pick this up

```
cd ~/Development/AI-DEMO-Standalone/standalone/pingone-signin-LAB
git checkout chore/phone-app-dock
npx vitest run   # in web/ for tests
docker compose -f docker-compose.yml up -d --build
open https://local.ping-devops.com:8443/pingone-signin-lab#/ciba
```
