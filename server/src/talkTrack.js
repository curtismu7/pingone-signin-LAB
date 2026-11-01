// The talk track is data (server/data/talk-track.json); docs/talk-track.md is generated from it (npm run talk-track) and a test fails on drift.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TALK_TRACK_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/talk-track.json');
export const loadTalkTrack = (file = TALK_TRACK_FILE) => JSON.parse(fs.readFileSync(file, 'utf8'));

// Markdown: the title, then each section's numbered steps (the first section has no heading).
export function renderTalkTrackMarkdown(data = loadTalkTrack()) {
  const out = [`# ${data.title}`, ''];
  for (const s of data.sections) {
    if (s.heading) out.push(`## ${s.heading}`, '');
    s.steps.forEach((step, i) => out.push(`${i + 1}. ${step}`));
    out.push('');
  }
  return out.join('\n');
}
