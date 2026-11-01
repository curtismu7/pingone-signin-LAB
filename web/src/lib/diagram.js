// diagram-studio/1 data -> what the Diagram tab draws. The data files live on the server (server/data/diagrams) and are fetched by name;
// this module only reshapes them. The validator runs on the server (vendored from the studio); the browser trusts what that route serves.
import { getJson } from "./api.js";

export const FILE_PREFIX = "pingone-signin-";
const TALL_FROM = 50; // a box whose text is this long gets the taller card (the format has no size field)

export const flowIdOf = (diagramId) => diagramId.slice(FILE_PREFIX.length);

export function flowFromDiagram(d) {
  const boxes = d.nodes.map((n) => {
    const sub = (n.sub || []).join(" ");
    return { id: n.id, position: { x: n.x, y: n.y }, data: { title: n.label, sub, tall: sub.length >= TALL_FROM } };
  });
  // The format has no arrow-direction field: a dashed edge is drawn one-way (a push with no answer); a solid edge is a request and its answer.
  const edges = d.edges.map((e) => ({ from: e.source, to: e.target, one: e.dashed === true }));
  const steps = (d.steps || []).map((s) => ({ title: s.title, say: s.what, edges: s.edges }));
  return { id: flowIdOf(d.id), name: d.title, boxes, edges, steps };
}

export async function loadFlows() {
  const { ids } = await getJson("/api/diagrams");
  const list = await Promise.all(ids.map((id) => getJson(`/api/diagrams/${encodeURIComponent(id)}`)));
  return Object.fromEntries(list.map((d) => { const f = flowFromDiagram(d); return [f.id, f]; }));
}
