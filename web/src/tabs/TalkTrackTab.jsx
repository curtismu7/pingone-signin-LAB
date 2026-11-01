import React from "react";
import talkTrack from "../../../docs/talk-track.md?raw";
import { Inert } from "../lib/Inert.jsx";

// The talk track (docs/talk-track.md) as the presenter's script. Plain text only: headings, numbered steps and paragraphs.
export default function TalkTrackTab() {
  const lines = talkTrack.split("\n");
  return (
    <div className="talk">
      <h2>Talk track</h2>
      <p className="lede">The script in <code>docs/talk-track.md</code>. Press P for presenter mode (Esc leaves it); there the arrow keys step the diagram.</p>
      {lines.map((l, i) => {
        if (!l.trim()) return null;
        if (/^#{1,3}\s/.test(l)) return <h3 key={i}><Inert text={l.replace(/^#+\s*/, "")} /></h3>;
        return <p key={i} className={/^\d+\./.test(l) ? "talk__step" : ""}><Inert text={l} /></p>;
      })}
    </div>
  );
}
