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
  /** 关系状态语义，与上游视觉常量五态一一对应；缺省视作 confirmed。 */
  status?: 'confirmed' | 'disputed' | 'asserted' | 'inferred' | 'missing';
};

export type VisualStructureRouting = {
  scene_id: string;
  selection_reason: string;
};

export type VisualStructure = {
  version: 1;
  title: string;
  /** v4：一图一观点，由模型在结构 JSON 顶部输出；长度 1-40 字。 */
  main_view?: string;
  /** 模型场景路由结论；成品图链路由 Rust 侧强制要求，本地确定性布局可缺省。 */
  routing?: VisualStructureRouting;
  nodes: VisualStructureNode[];
  edges: VisualStructureEdge[];
};

export function validateVisualStructure(value: unknown): VisualStructure {
  if (!value || typeof value !== 'object') throw new Error('生成结果不是图表结构');
  const structure = value as Partial<VisualStructure>;
  if (structure.version !== 1 || typeof structure.title !== 'string' || !Array.isArray(structure.nodes) || !Array.isArray(structure.edges)) {
    throw new Error('生成结果缺少图表结构字段');
  }
  if (structure.routing !== undefined) {
    const routing = structure.routing as Partial<VisualStructureRouting> | null;
    if (!routing || typeof routing.scene_id !== 'string' || !routing.scene_id
      || typeof routing.selection_reason !== 'string' || !routing.selection_reason.trim()) {
      throw new Error('生成结果的场景路由结论无效');
    }
  }
  const ids = new Set<string>();
  for (const node of structure.nodes) {
    if (!node || typeof node.id !== 'string' || !node.id || typeof node.text !== 'string') throw new Error('生成节点格式无效');
    if (ids.has(node.id)) throw new Error(`生成节点编号重复：${node.id}`);
    ids.add(node.id);
  }
  for (const edge of structure.edges) {
    if (!edge || typeof edge.id !== 'string' || !ids.has(edge.sourceId) || !ids.has(edge.targetId)) throw new Error('生成连接关系无效');
    if (edge.status !== undefined) {
      const allowed = ['confirmed', 'disputed', 'asserted', 'inferred', 'missing'];
      if (!allowed.includes(edge.status)) throw new Error(`关系 status 取值非法：${edge.status}`);
    }
  }
  if (structure.main_view !== undefined) {
    if (typeof structure.main_view !== 'string') throw new Error('main_view 类型应为字符串');
    if (structure.main_view.length > 0 && structure.main_view.length > 40) throw new Error('main_view 超过 40 字');
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
  const layerSpacing = visualType === 'timeline' ? 118 : visualType === 'relationship' ? 112 : 96;
  return {
    'elk.algorithm': 'layered',
    'elk.direction': direction,
    'elk.spacing.nodeNode': visualType === 'mindmap' ? '52' : '44',
    'elk.spacing.edgeEdge': '18',
    'elk.spacing.edgeNode': '24',
    'elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing),
    'elk.layered.spacing.edgeNodeBetweenLayers': '28',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
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
  const titleBandHeight = input.title.trim() ? 82 : 0;
  const positions = new Map((graph.children ?? []).map((child) => [child.id, child]));
  const nodes: DiagramNode[] = structure.nodes.map((node) => {
    const position = positions.get(node.id);
    const size = sizes.get(node.id)!;
    return {
      id: node.id,
      kind: 'node',
      text: node.text,
      bounds: { x: position?.x ?? 48, y: (position?.y ?? 48) + titleBandHeight, width: size.width, height: size.height },
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
        .map((point) => ({ x: point.x, y: point.y + titleBandHeight }))
      : undefined;
    return {
      id: edge.id,
      kind: 'edge',
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      label: edge.label,
      points,
      source: edge.source,
      // v4：缺省 = confirmed；样式交由渲染层按 status 选 stroke/dash/label 前缀。
      style: {
        arrow: 'end',
        ...(edge.status ? { dashed: edge.status !== 'confirmed' } : {}),
        ...(edge.status ? { status: edge.status } : {}),
      },
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
      routing: structure.routing
        ? { sceneId: structure.routing.scene_id, selectionReason: structure.routing.selection_reason }
        : undefined,
    },
    canvas: {
      width: Math.max(640, Math.ceil(graph.width ?? 640)),
      height: Math.max(420, Math.ceil((graph.height ?? 420) + titleBandHeight)),
      background: '',
      padding: 48,
    },
    elements: [...nodes, ...edges],
    history: [],
  });
}
