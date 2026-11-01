import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, applyNodeChanges } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Inert } from "../lib/Inert.jsx";
import { Mock, Btn } from "../components/ui.jsx";

// Browser, BFF, mock PingOne, resource server and mock phone, drawn from the diagram-studio data files the server serves (see docs/diagrams.md).
// Boxes are draggable; Simulate walks the chosen flow step by step, Reset puts the boxes and the walk back, the speed control sets the pace.
// ReactFlow only: this app draws no other diagrams. What is code here: which side of a box an arrow leaves from, the walk and the lighting.
// Which sides of the two boxes a pair of boxes is joined at.
const SIDES = { "bff|browser": ["l", "r"], "bff|op": ["r", "l"], "bff|rs": ["b", "t"], "op|phone": ["b", "t"] };
const key = (a, b) => [a, b].sort().join("|");
const sidesFor = (from, to) => { const [s, t] = SIDES[key(from, to)] || ["r", "l"]; return key(from, to).split("|")[0] === from ? [s, t] : [t, s]; };

const SPEEDS = [["0.5", "0.5x"], ["1", "1x"], ["2", "2x"], ["4", "4x"]];
const BASE_MS = 1600;
const SLOTS = 12; // handle positions per side; the edges joining one pair of boxes are spread evenly over them so their numbers do not overlap
const POS = { l: Position.Left, r: Position.Right, t: Position.Top, b: Position.Bottom };
const at = (slot) => `${8 + slot * (84 / (SLOTS - 1))}%`;
const slotFor = (j, n) => (n <= 1 ? Math.floor((SLOTS - 1) / 2) : Math.round(j * ((SLOTS - 1) / (n - 1)))); // the j-th of n parallel edges

function Box({ data }) {
  return (
    <div className={`fbox${data.tall ? " fbox--tall" : ""}${data.on ? " on" : ""}${data.dim ? " dim" : ""}`}>
      {Object.entries(POS).flatMap(([side, pos]) => Array.from({ length: SLOTS }, (_, i) => {
        const style = pos === Position.Left || pos === Position.Right ? { top: at(i) } : { left: at(i) };
        return [
          <Handle key={`${side}${i}s`} id={`${side}${i}`} type="source" position={pos} style={style} isConnectable={false} />,
          <Handle key={`${side}${i}t`} id={`${side}${i}`} type="target" position={pos} style={style} isConnectable={false} />,
        ];
      }))}
      <strong>{data.title}</strong>
      <span>{data.sub}</span>
    </div>
  );
}
const nodeTypes = { box: Box };

// The arrows for the walk. Step i lights exactly the edges listed in step i's `edges`; other edges are past or idle.
// An edge that no step lists never lights and has no number.
export function buildEdges(flow, cursor, flowId) {
  const used = {}; const total = {};
  for (const e of flow.edges) { const k = key(e.from, e.to); total[k] = (total[k] ?? 0) + 1; }
  const stepOf = (i) => flow.steps.findIndex((s) => s.edges.includes(i)); // the step an arrow belongs to: its number, and when it lights
  return flow.edges.map((e, i) => {
    const k = key(e.from, e.to); const slot = slotFor((used[k] = (used[k] ?? -1) + 1), total[k]);
    const [a, b] = sidesFor(e.from, e.to);
    const n = stepOf(i);
    const state = n >= 0 && n === cursor ? "on" : n >= 0 && n < cursor ? "past" : "idle";
    return {
      id: `${flowId}-${i}`, source: e.from, target: e.to, sourceHandle: `${a}${slot}`, targetHandle: `${b}${slot}`, label: n >= 0 ? String(n + 1) : undefined, className: `edge-${state}`, animated: state === "on",
      markerEnd: { type: MarkerType.ArrowClosed }, ...(e.one ? {} : { markerStart: { type: MarkerType.ArrowClosed } }),
    };
  });
}

export default function DiagramTab({ app }) {
  const { cursor, setCursor, boxes, setBoxes, theme, flows, flowId = "login", setFlowId = () => {}, present = false, stepBy = null } = app;
  const [speed, setSpeed] = useState("1");
  const [running, setRunning] = useState(false);
  const flow = flows[flowId];
  const steps = flow.steps;

  useEffect(() => {
    if (!running) return undefined;
    if (cursor >= steps.length - 1) { setRunning(false); return undefined; }
    const t = setTimeout(() => setCursor(cursor + 1), BASE_MS / Number(speed));
    return () => clearTimeout(t);
  }, [running, cursor, steps.length, speed, setCursor]);

  const simulate = () => { setCursor(0); setRunning(true); };
  const reset = () => { setRunning(false); setCursor(-1); setBoxes(flow.boxes); };
  const pickFlow = (id) => { setRunning(false); setCursor(-1); setFlowId(id); };
  const onNodesChange = useCallback((changes) => setBoxes((n) => applyNodeChanges(changes, n)), [setBoxes]);

  const cur = cursor >= 0 ? steps[Math.min(cursor, steps.length - 1)] : null;
  const curEdges = cur ? cur.edges : [];
  const lit = curEdges.flatMap((i) => [flow.edges[i].from, flow.edges[i].to]);
  const nodes = useMemo(() => boxes.map((n) => ({ ...n, type: "box", data: { ...n.data, on: lit.includes(n.id), dim: !!cur && !lit.includes(n.id) } })), [boxes, cur]); // eslint-disable-line react-hooks/exhaustive-deps
  const edges = useMemo(() => buildEdges(flow, cursor, flowId), [flow, cursor, flowId]);

  const caption = cur ? `Step ${cursor + 1} of ${steps.length}: ${cur.say}` : "Press Simulate to walk the steps through the diagram. Drag any box to rearrange it.";

  return (
    <>
      <h2>Diagram</h2>
      <p className="lede">Who talks to whom. Drag any box. Simulate lights each exchange in order; the numbers on the lines match the list below. Arrows at both ends mean a request and its answer. The mock names (acr strings, statuses, the 8 character limit) are labelled <Mock>mock</Mock>.</p>
      <div className="card controls">
        <label>Flow
          <select value={flowId} onChange={(e) => pickFlow(e.target.value)}>{Object.keys(flows).map((id) => <option key={id} value={id}>{flows[id].name}</option>)}</select>
        </label>
        <label>Speed
          <select value={speed} onChange={(e) => setSpeed(e.target.value)}>{SPEEDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
        </label>
        <Btn type="button" className="primary" onClick={simulate} disabled={running}>Simulate</Btn>
        <button type="button" onClick={reset}>Reset</button>
        {stepBy && <Btn type="button" onClick={() => { setRunning(false); stepBy(-1); }} disabled={cursor <= 0}>Previous step</Btn>}
        {stepBy && <Btn type="button" onClick={() => { setRunning(false); stepBy(1); }} disabled={cursor >= steps.length - 1}>Next step</Btn>}
      </div>
      {present && <p className="muted small" data-testid="present-hint">Presenter mode: the Right and Left arrow keys (or Page Down and Page Up) step through the flow.</p>}
      <div className="flow-wrap" role="group" aria-label="Sequence diagram: browser, BFF, mock PingOne, resource server and mock phone. Boxes can be dragged.">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} colorMode={theme}
          fitView fitViewOptions={{ padding: 0.1 }} nodesConnectable={false} proOptions={{ hideAttribution: true }} minZoom={0.2}>
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <p className="caption" role="status" aria-live="polite" data-testid="caption"><Inert text={caption} /></p>
      <ol className="legend" aria-label="Steps">
        {steps.map((s, i) => <li key={i} aria-current={i === cursor ? "step" : undefined} className={i === cursor ? "is-current" : ""}>{s.say}</li>)}
      </ol>
    </>
  );
}
