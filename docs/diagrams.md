# Diagrams (rule 17)

The three flows (sign in, step-up, CIBA) are **diagram-studio/1 data**, not code: `server/data/diagrams/pingone-signin-login.json`, `-stepup.json`, `-ciba.json`. Names follow the studio's lowercase `^[a-z0-9][a-z0-9_-]*$` ids, prefixed with the app name.

## What is data
- Boxes (`nodes`: id, group, label, `sub` text, `x`/`y` = where the box starts and where Reset puts it back), the arrows (`edges`), the `groups` (their colour names are validated and kept in the file, but this tab does not draw them: boxes are not coloured by group), and the `steps` (title, `what` = the text shown in the caption and the step list, `edges` = which arrow lights). Every mock / UNVERIFIED label lives in that text.
- The same five boxes at the same positions are in all three files (the boxes are shared across the three flows in the tab); a test pins this.
- Validated at server start and in `server/test/diagrams.test.js` by a **vendored copy** of the studio validator (`server/src/vendor/diagram-validate.js`; header names the source repo and commit; body pinned by a hash in the test). To update it: copy `core/src/validate.js` from the studio, put the two header lines back with the new commit and date, update the hash in the test, rerun the tests. Nothing is imported across repos.
- Served by `GET /api/diagrams` (the id list) and `GET /api/diagrams/:id`. The files are read once at startup and served from memory; the id is checked against the id pattern and a fixed allowlist, so no request value reaches the file system. Read-only.
- The content pack lists the same file ids under `diagrams`.

## What is not data (stays app code)
- Rendering with this repo's own ReactFlow: movable boxes, Simulate, Reset (restores positions), speed control, presenter stepping, the page's CSP.
- Live highlighting and the Simulate wiring: the walk is driven by the tab, not by a live run.
- Which side of a box an arrow leaves from (`SIDES` in `DiagramTab.jsx`) and the stacking of several arrows between the same two boxes.
- How the format is mapped where it has no field: a box whose text is 50 characters or more gets the taller card (the format has no size field), and a **dashed edge is drawn one-way** (a push with no answer); a solid edge is drawn with an arrowhead at both ends (a request and its answer).

## Gap list for the studio team
1. No external step-control API or postMessage on the embed (`/?embed=1&d=<id>`): a host app cannot say "light step 3".
2. `frame-ancestors` allows `http://localhost` / `127.0.0.1` only, so the viewer cannot be framed from another origin. This is why the lab renders the data with its own ReactFlow and does not embed the studio.
3. No live trace highlighting: nothing can drive the viewer from a real run's events.
4. No host hook for node content or renderers: the viewer has one fixed node type (`box`: label, up to 6 sub lines of 120 characters, and the group colour). The lab's boxes can only carry a title and short lines.
5. No direction or request/answer field. Every edge is drawn with one arrowhead at its target (Canvas.jsx:27); `dashed` is a boolean stroke style and the studio library uses it for return arrows (library.js:114-137). The lab reuses `dashed` to mean one way with no answer, and draws solid edges with arrowheads at both ends. A studio reader will therefore see one-headed arrows, and dashed lines that read as responses. The studio-native form is two edges per exchange (request, dashed answer), which would change the numbering and the look.
6. No box-size or layout hint (`tall`), and no per-edge anchor side, so the lab keeps both in code.
