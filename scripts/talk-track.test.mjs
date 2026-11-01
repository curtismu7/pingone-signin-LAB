// The talk track doc is generated from server/data/talk-track.json: it must not drift, and what it names must exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadTalkTrack, renderTalkTrackMarkdown } from '../server/src/talkTrack.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('docs/talk-track.md equals what the talk-track data renders (run: npm run talk-track)', () => {
  assert.equal(read('docs/talk-track.md'), renderTalkTrackMarkdown(loadTalkTrack()));
});

test('every scenario slug the talk track names exists in the scenario data', () => {
  const slugs = new Set(JSON.parse(read('server/data/scenarios.json')).map((s) => s.slug));
  const named = [...read('docs/talk-track.md').matchAll(/"scenario":"([a-z0-9-]+)"|`([a-z]+(?:-[a-z]+)+)`/g)].map((m) => m[1] || m[2]).filter((x) => !['response-mode', 'pi-flow'].includes(x));
  const scenarioish = named.filter((n) => /^(happy|stale|wrong|replayed|step-up|ciba|lockout|expired|redirect|mfa)/.test(n));
  assert.ok(scenarioish.length >= 8, `found ${scenarioish.length}`);
  for (const n of scenarioish) assert.ok(slugs.has(n), `${n} is not a scenario slug`);
});

test('the talk track data has a title, steps in every section, and no unrendered token', () => {
  const d = loadTalkTrack();
  assert.ok(d.title && d.sections.length >= 2);
  for (const s of d.sections) assert.ok(s.steps.length > 0 && s.steps.every((x) => typeof x === 'string' && x.trim()));
  assert.doesNotMatch(renderTalkTrackMarkdown(d), /\{\{/);
});

test('a changed data file would fail the drift test (the check is live)', () => {
  const d = loadTalkTrack();
  d.sections[0].steps[0] += ' changed';
  assert.notEqual(read('docs/talk-track.md'), renderTalkTrackMarkdown(d));
});
