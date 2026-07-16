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
