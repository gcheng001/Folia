import type { FreeFlowEndpoint, FreeFlowLine } from './canvasSidecar';

export interface FlowPoint {
  x: number;
  y: number;
}

export interface FreeLineNodeBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DirectionBucket = 'horizontal' | 'vertical' | 'diag-down' | 'diag-up' | 'mixed';

const SNAP_DISTANCE = 28;

function distance(a: FlowPoint, b: FlowPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

type BoundAnchor = Extract<FreeFlowEndpoint, { kind: 'bound' }>['anchor'];

export function anchorPoint(node: FreeLineNodeBox, anchor: BoundAnchor): FlowPoint {
  switch (anchor) {
    case 'left':
      return { x: node.x, y: node.y + node.height / 2 };
    case 'right':
      return { x: node.x + node.width, y: node.y + node.height / 2 };
    case 'top':
      return { x: node.x + node.width / 2, y: node.y };
    case 'bottom':
      return { x: node.x + node.width / 2, y: node.y + node.height };
    case 'center':
    default:
      return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
  }
}

export function resolveEndpoint(endpoint: FreeFlowEndpoint, nodes: FreeLineNodeBox[]): FlowPoint {
  if (endpoint.kind === 'free') return { x: endpoint.x, y: endpoint.y };
  const node = nodes.find((item) => item.id === endpoint.nodeId);
  if (node) return anchorPoint(node, endpoint.anchor);
  if (typeof endpoint.x === 'number' && typeof endpoint.y === 'number') return { x: endpoint.x, y: endpoint.y };
  return { x: 0, y: 0 };
}

function nearestNodeAnchor(point: FlowPoint, nodes: FreeLineNodeBox[], threshold = SNAP_DISTANCE): FreeFlowEndpoint | null {
  let best: { endpoint: FreeFlowEndpoint; d: number } | null = null;
  for (const node of nodes) {
    for (const anchor of ['left', 'right', 'top', 'bottom', 'center'] as const) {
      const p = anchorPoint(node, anchor);
      const d = distance(point, p);
      if (d <= threshold && (!best || d < best.d)) {
        best = { endpoint: { kind: 'bound', nodeId: node.id, anchor, x: p.x, y: p.y }, d };
      }
    }
  }
  return best?.endpoint ?? null;
}

export function classifyDirection(start: FlowPoint, end: FlowPoint): DirectionBucket {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.hypot(dx, dy) < 1) return 'mixed';
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  const normalized = ((angle % 180) + 180) % 180;
  if (normalized <= 22.5 || normalized >= 157.5) return 'horizontal';
  if (normalized >= 67.5 && normalized <= 112.5) return 'vertical';
  return dy * dx >= 0 ? 'diag-down' : 'diag-up';
}

function snapToDirection(start: FlowPoint, end: FlowPoint, direction: DirectionBucket): FlowPoint {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1 || direction === 'mixed') return end;
  const sx = dx >= 0 ? 1 : -1;
  switch (direction) {
    case 'horizontal':
      return { x: end.x, y: start.y };
    case 'vertical':
      return { x: start.x, y: end.y };
    case 'diag-down': {
      const side = length / Math.SQRT2;
      return { x: start.x + sx * side, y: start.y + sx * side };
    }
    case 'diag-up': {
      const side = length / Math.SQRT2;
      return { x: start.x + sx * side, y: start.y - sx * side };
    }
    default:
      return end;
  }
}

export function snapEndpoint(
  point: FlowPoint,
  nodes: FreeLineNodeBox[],
  options: { bindToNode: boolean },
): FreeFlowEndpoint {
  const bound = nearestNodeAnchor(point, nodes);
  if (bound) {
    if (options.bindToNode) return bound;
    return { kind: 'free', x: bound.x ?? point.x, y: bound.y ?? point.y };
  }
  return { kind: 'free', x: point.x, y: point.y };
}

export function snapLineEnd(
  start: FlowPoint,
  rawEnd: FlowPoint,
  nodes: FreeLineNodeBox[],
  options: { bindToNode: boolean; angleSnap: boolean },
): FreeFlowEndpoint {
  const bound = nearestNodeAnchor(rawEnd, nodes);
  if (bound) {
    if (options.bindToNode) return bound;
    return { kind: 'free', x: bound.x ?? rawEnd.x, y: bound.y ?? rawEnd.y };
  }
  const direction = classifyDirection(start, rawEnd);
  const point = options.angleSnap ? snapToDirection(start, rawEnd, direction) : rawEnd;
  return { kind: 'free', x: point.x, y: point.y };
}

export function endpointPoint(endpoint: FreeFlowEndpoint): FlowPoint {
  if (endpoint.kind === 'free') return endpoint;
  return { x: endpoint.x ?? 0, y: endpoint.y ?? 0 };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function majority<T extends string>(values: T[]): T | null {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return null;
  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) return null;
  return sorted[0][0];
}

export function tidyFreeLines(lines: FreeFlowLine[], nodes: FreeLineNodeBox[]): FreeFlowLine[] {
  if (lines.length === 0) return [];
  const resolved = lines.map((line) => {
    const start = resolveEndpoint(line.start, nodes);
    const end = resolveEndpoint(line.end, nodes);
    return { line, start, end, length: distance(start, end), direction: classifyDirection(start, end) };
  }).filter((item) => item.length >= 1);
  const direction = majority(resolved.map((item) => item.direction).filter((item) => item !== 'mixed'));
  const arrow = majority(lines.map((line) => line.arrow));
  const targetLength = median(resolved.map((item) => item.length));
  if (!direction || targetLength < 1) {
    return lines.map((line) => arrow ? { ...line, arrow } : line);
  }
  return lines.map((line) => {
    const start = resolveEndpoint(line.start, nodes);
    const end = resolveEndpoint(line.end, nodes);
    const cx = (start.x + end.x) / 2;
    const cy = (start.y + end.y) / 2;
    let dx = targetLength / 2;
    let dy = 0;
    if (direction === 'vertical') {
      dx = 0;
      dy = targetLength / 2;
    } else if (direction === 'diag-down') {
      dx = targetLength / (2 * Math.SQRT2);
      dy = dx;
    } else if (direction === 'diag-up') {
      dx = targetLength / (2 * Math.SQRT2);
      dy = -dx;
    }
    return {
      ...line,
      arrow: arrow ?? line.arrow,
      start: { kind: 'free', x: cx - dx, y: cy - dy },
      end: { kind: 'free', x: cx + dx, y: cy + dy },
    };
  });
}
