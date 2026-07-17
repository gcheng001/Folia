import { structureToScene, type VisualStructure } from '../diagram/structure';
import { fallbackTextMeasurer } from '../diagram/textMeasure';
import { isDiagramNode } from '../diagram/types';
import type { TraceableElement, ViewFamily, VisualSheet } from './types';
import {
  LEGAL_CANVAS_ORIGIN,
  chineseNodeWidth,
  nodeSizing,
  type NodeSizing,
} from './legalVisuals';

export const DEFAULT_GRAPH_FOCUS_LIMIT = 18;

export type FocusedGraph = {
  nodes: TraceableElement[];
  edges: TraceableElement[];
  hiddenNodeCount: number;
};

function nodePriority(element: TraceableElement, family: ViewFamily, degree: Map<string, number>): number {
  if (family === 'structure-overview') {
    const level = Number(element.data.level ?? 9);
    return (10 - Math.min(9, level)) * 10_000 - element.anchor.start;
  }
  if (family === 'relationship') return (degree.get(element.id) ?? 0) * 10_000 - element.anchor.start;
  return -element.anchor.start;
}

export function focusGraph(sheet: VisualSheet, expanded: boolean, limit = DEFAULT_GRAPH_FOCUS_LIMIT): FocusedGraph {
  const nodes = sheet.elements.filter((element) => element.kind === 'node');
  const edges = sheet.elements.filter((element) => element.kind === 'edge');
  const familyLimit = sheet.family === 'structure-overview'
    ? Math.min(limit, 12)
    : sheet.family === 'relationship'
      ? Math.min(limit, 14)
      : limit;
  if (expanded || nodes.length <= familyLimit) return { nodes, edges, hiddenNodeCount: 0 };

  const degree = new Map<string, number>();
  edges.forEach((edge) => {
    const from = typeof edge.data.from === 'string' ? edge.data.from : '';
    const to = typeof edge.data.to === 'string' ? edge.data.to : '';
    if (from) degree.set(from, (degree.get(from) ?? 0) + 1);
    if (to) degree.set(to, (degree.get(to) ?? 0) + 1);
  });
  const focused = nodes
    .toSorted((left, right) => nodePriority(right, sheet.family, degree) - nodePriority(left, sheet.family, degree))
    .slice(0, familyLimit)
    .toSorted((left, right) => left.anchor.start - right.anchor.start);
  const ids = new Set(focused.map((node) => node.id));
  return {
    nodes: focused,
    edges: edges.filter((edge) => ids.has(String(edge.data.from ?? '')) && ids.has(String(edge.data.to ?? ''))),
    hiddenNodeCount: nodes.length - focused.length,
  };
}

function visualTypeForFamily(family: ViewFamily): 'flowchart' | 'relationship' | 'mindmap' {
  if (family === 'flow') return 'flowchart';
  if (family === 'relationship') return 'relationship';
  return 'mindmap';
}

export type GraphLayoutNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export async function layoutFocusedGraph(
  family: ViewFamily,
  nodes: TraceableElement[],
  edges: TraceableElement[],
  labelFor: (element: TraceableElement) => string,
): Promise<GraphLayoutNode[]> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const structure: VisualStructure = {
    version: 1,
    title: '',
    nodes: nodes.map((node, index) => ({
      id: node.id,
      text: labelFor(node),
      emphasis: index === 0 || Number(node.data.level) === 1 ? 'strong' : 'normal',
    })),
    edges: edges.flatMap((edge) => {
      const sourceId = typeof edge.data.from === 'string' ? edge.data.from : '';
      const targetId = typeof edge.data.to === 'string' ? edge.data.to : '';
      if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) return [];
      return [{ id: edge.id, sourceId, targetId, label: labelFor(edge) }];
    }),
  };
  const scene = await structureToScene(structure, {
    visualType: visualTypeForFamily(family),
    style: 'light-formal',
    measure: fallbackTextMeasurer,
  });
  const laidOut = scene.elements.filter(isDiagramNode);
  if (laidOut.length === 0) return [];
  const minX = Math.min(...laidOut.map((node) => node.bounds.x), 0);
  const minY = Math.min(...laidOut.map((node) => node.bounds.y), 0);
  // 上游视觉常量：节点数 1-7/8-15/16+ 三档给到最小尺寸；ELK 出来后再用 chineseNodeWidth
  // 顶到中文最小宽；最后整体平移 (origin.x, origin.y) 与上游坐标系对齐。
  const sizing: NodeSizing = nodeSizing(laidOut.length);
  const labelById = new Map(nodes.map((node) => [node.id, labelFor(node)]));
  return laidOut.map((node) => {
    const label = labelById.get(node.id) ?? '';
    const width = Math.max(node.bounds.width, chineseNodeWidth(label, sizing));
    return {
      id: node.id,
      x: node.bounds.x - minX + LEGAL_CANVAS_ORIGIN.x,
      y: node.bounds.y - minY + LEGAL_CANVAS_ORIGIN.y,
      width,
      height: node.bounds.height,
    };
  });
}
