import type { SkillVisualStyle, SkillVisualType } from '../skillVisualService';

export const DIAGRAM_SCENE_VERSION = 1 as const;

export type DiagramRect = { x: number; y: number; width: number; height: number };
export type DiagramPoint = { x: number; y: number };

export type DiagramSourceAnchor = {
  path?: string;
  start?: number;
  end?: number;
  excerpt?: string;
  contentHash?: string;
};

export type ManualProtection = {
  text?: boolean;
  position?: boolean;
  size?: boolean;
  style?: boolean;
  connection?: boolean;
};

export type DiagramNode = {
  id: string;
  kind: 'node';
  text: string;
  bounds: DiagramRect;
  parentId?: string;
  style?: {
    fill?: string;
    stroke?: string;
    textColor?: string;
    fontSize?: number;
    fontWeight?: number;
    radius?: number;
  };
  source?: DiagramSourceAnchor;
  protected?: ManualProtection;
  legacy?: {
    locked: boolean;
    confidence: number;
    elementIndexes: number[];
    textRuns?: Array<{ text: string; x: number; y: number; fontSize: number; width: number; height: number }>;
  };
};

export type DiagramEdge = {
  id: string;
  kind: 'edge';
  sourceId: string;
  targetId: string;
  label?: string;
  points?: DiagramPoint[];
  style?: {
    color?: string;
    width?: number;
    dashed?: boolean;
    arrow?: 'none' | 'end' | 'both';
    fontSize?: number;
    /** v4：上游视觉常量五态，缺省视作 confirmed。渲染层按 status 选 stroke/dash。 */
    status?: 'confirmed' | 'disputed' | 'asserted' | 'inferred' | 'missing';
  };
  source?: DiagramSourceAnchor;
  protected?: ManualProtection;
  legacy?: {
    locked: boolean;
    confidence: number;
    elementIndexes: number[];
  };
};

export type DiagramDecoration = {
  id: string;
  kind: 'decoration';
  bounds?: DiagramRect;
  rawSvg: string;
  locked: true;
};

export type DiagramElement = DiagramNode | DiagramEdge | DiagramDecoration;

export type DiagramHistoryEntry = {
  id: string;
  label: string;
  createdAt: string;
  sceneJson: string;
};

export type VisualRouting = {
  sceneId: string;
  selectionReason: string;
};

export type DiagramScene = {
  version: typeof DIAGRAM_SCENE_VERSION;
  checksum: string;
  document: {
    id: string;
    title: string;
    visualType: SkillVisualType;
    style: SkillVisualStyle;
    createdAt: string;
    updatedAt: string;
    source?: DiagramSourceAnchor;
    /** 模型的场景路由结论（scene_id + 选型理由），随场景元数据持久化，供用户核对选型。 */
    routing?: VisualRouting;
    legacyProjection?: boolean;
  };
  canvas: {
    width: number;
    height: number;
    background: string;
    padding: number;
  };
  elements: DiagramElement[];
  history?: DiagramHistoryEntry[];
};

export function isDiagramNode(element: DiagramElement): element is DiagramNode {
  return element.kind === 'node';
}

export function isDiagramEdge(element: DiagramElement): element is DiagramEdge {
  return element.kind === 'edge';
}
