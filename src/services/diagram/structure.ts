import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from 'elkjs/lib/elk-api';
import type { SkillVisualStyle, SkillVisualType } from '../skillVisualService';
import { withSceneChecksum } from './sceneSchema';
import { browserTextMeasurer, wrapText, type TextMeasurer } from './textMeasure';
import type { DiagramEdge, DiagramNode, DiagramScene, DiagramSourceAnchor } from './types';

export type VisualStructureNode = {
  id: string;
  text: string;
  parentId?: string;
  source?: DiagramSourceAnchor;
  emphasis?: 'normal' | 'strong';
};

export type VisualStructureEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  label?: string;
  source?: DiagramSourceAnchor;
};

export type VisualStructure = {
  version: 1;
  title: string;
  nodes: VisualStructureNode[];
  edges: VisualStructureEdge[];
};

export function validateVisualStructure(value: unknown): VisualStructure {
  if (!value || typeof value !== 'object') throw new Error('生成结果不是图表结构');
  const structure = value as Partial<VisualStructure>;
  if (structure.version !== 1 || typeof structure.title !== 'string' || !Array.isArray(structure.nodes) || !Array.isArray(structure.edges)) {
    throw new Error('生成结果缺少图表结构字段');
  }
  const ids = new Set<string>();
  for (const node of structure.nodes) {
    if (!node || typeof node.id !== 'string' || !node.id || typeof node.text !== 'string') throw new Error('生成节点格式无效');
    if (ids.has(node.id)) throw new Error(`生成节点编号重复：${node.id}`);
    ids.add(node.id);
  }
  for (const edge of structure.edges) {
    if (!edge || typeof edge.id !== 'string' || !ids.has(edge.sourceId) || !ids.has(edge.targetId)) throw new Error('生成连接关系无效');
  }
  if (structure.nodes.length === 0 || structure.nodes.length > 300 || structure.edges.length > 600) throw new Error('生成图表规模超出安全范围');
  return structure as VisualStructure;
}

function nodeSize(text: string, emphasis: boolean, measure: TextMeasurer) {
  const fontSize = emphasis ? 16 : 14;
  const maxTextWidth = emphasis ? 250 : 220;
  const wrapped = wrapText(text, maxTextWidth, {
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
    fontSize,
    fontWeight: emphasis ? 700 : 500,
  }, measure);
  return {
    width: Math.max(120, Math.ceil(wrapped.width + 32)),
    height: Math.max(56, Math.ceil(wrapped.height + 28)),
    fontSize,
  };
}

function layoutOptions(visualType: SkillVisualType): Record<string, string> {
  const direction = visualType === 'flowchart' ? 'DOWN' : 'RIGHT';
  return {
    'elk.algorithm': 'layered',
    'elk.direction': direction,
    'elk.spacing.nodeNode': '44',
    'elk.layered.spacing.nodeNodeBetweenLayers': visualType === 'timeline' ? '80' : '96',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    'elk.padding': '[top=48,left=48,bottom=48,right=48]',
  };
}

export async function structureToScene(
  input: VisualStructure,
  options: {
    visualType: SkillVisualType;
    style: SkillVisualStyle;
    source?: DiagramSourceAnchor;
    measure?: TextMeasurer;
  },
): Promise<DiagramScene> {
  const structure = validateVisualStructure(input);
  const measure = options.measure ?? browserTextMeasurer;
  const sizes = new Map(structure.nodes.map((node) => [node.id, nodeSize(node.text, node.emphasis === 'strong', measure)]));
  const elk = new ELK();
  const inputGraph: ElkNode = {
    id: 'root',
    layoutOptions: layoutOptions(options.visualType),
    children: structure.nodes.map((node) => ({ id: node.id, width: sizes.get(node.id)!.width, height: sizes.get(node.id)!.height })),
    edges: structure.edges.map((edge) => ({ id: edge.id, sources: [edge.sourceId], targets: [edge.targetId] })),
  };
  const graph = await elk.layout(inputGraph);
  const positions = new Map((graph.children ?? []).map((child) => [child.id, child]));
  const nodes: DiagramNode[] = structure.nodes.map((node) => {
    const position = positions.get(node.id);
    const size = sizes.get(node.id)!;
    return {
      id: node.id,
      kind: 'node',
      text: node.text,
      bounds: { x: position?.x ?? 48, y: position?.y ?? 48, width: size.width, height: size.height },
      style: { fontSize: size.fontSize, fontWeight: node.emphasis === 'strong' ? 700 : 500 },
      source: node.source,
    };
  });
  const edgeLayouts = new Map((graph.edges ?? []).map((edge) => [edge.id, edge]));
  const edges: DiagramEdge[] = structure.edges.map((edge) => {
    const layout = edgeLayouts.get(edge.id);
    const section = layout?.sections?.[0];
    const points = section
      ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
        .map((point) => ({ x: point.x, y: point.y }))
      : undefined;
    return {
      id: edge.id,
      kind: 'edge',
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      label: edge.label,
      points,
      source: edge.source,
      style: { arrow: 'end' },
    };
  });
  const now = new Date().toISOString();
  return withSceneChecksum({
    version: 1,
    checksum: '',
    document: {
      id: `visual-${crypto.randomUUID?.() ?? Date.now().toString(36)}`,
      title: structure.title,
      visualType: options.visualType,
      style: options.style,
      createdAt: now,
      updatedAt: now,
      source: options.source,
    },
    canvas: {
      width: Math.max(640, Math.ceil(graph.width ?? 640)),
      height: Math.max(420, Math.ceil(graph.height ?? 420)),
      background: '',
      padding: 48,
    },
    elements: [...nodes, ...edges],
    history: [],
  });
}
