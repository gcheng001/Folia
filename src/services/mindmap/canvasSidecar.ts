/**
 * 脑图画布 sidecar：MD 仍是唯一源；这些字段都是「可丢弃」的画布状态。
 *
 * 按文件隔离（documentKey = 绝对路径或文件名）。整体序列化到 localStorage
 * 一个键里：v1 是分键存储（见 positionStore），v2 起合并为单一 JSON
 * 文档，便于一次性读取与写入，并解决原 positionStore 在「节点改名/移动」
 * 场景下内容路径冲突导致坐标串文件的隐患——节点路径在文档内容里出现多次
 * 仍能正常合并，新的分组/连线字段天然享受同样的合并保护。
 */
import { loadMindMapPositions, type MindMapPosition } from './positionStore';

export type EdgeDisplayMode = 'mindmap' | 'flow' | 'none';

export const CURRENT_SCHEMA_VERSION = 4;

export type FreeFlowEndpoint =
  | { kind: 'free'; x: number; y: number }
  | { kind: 'bound'; nodeId: string; anchor: 'left' | 'right' | 'top' | 'bottom' | 'center'; x?: number; y?: number };

/** 自定义连线：脱离父子关系，纯粹由用户拖拽产生。 */
export interface CustomFlowEdge {
  id: string;
  source: string;
  target: string;
  /** 单向 one-way / 双向 both / 无箭头 none */
  arrow: 'one-way' | 'both' | 'none';
  /** 直线 straight / 折线 step */
  shape: 'straight' | 'step';
  /** 实线 solid / 虚线 dashed */
  dash: 'solid' | 'dashed';
  color: string;
  width: number;
}

/** 自由流程线：端点可以是画布坐标，也可以吸附绑定到节点锚点。 */
export interface FreeFlowLine {
  id: string;
  start: FreeFlowEndpoint;
  end: FreeFlowEndpoint;
  /** 单向 one-way / 双向 both / 无箭头 none */
  arrow: 'one-way' | 'both' | 'none';
  /** 直线 straight / 折线 step */
  shape: 'straight' | 'step';
  /** 实线 solid / 虚线 dashed */
  dash: 'solid' | 'dashed';
  color: string;
  width: number;
}

export interface AnnotationStyle {
  /** 实线 solid / 虚线 dashed */
  borderStyle: 'solid' | 'dashed';
  color: string;
  width: number;
  /** 填充 none 透明 / light 浅色 */
  fill: 'none' | 'light';
  /** 直角 square / 圆角 rounded */
  corner: 'square' | 'rounded';
}

/** 标注框：用户主动圈选多个节点后生成；节点移动时框自动调整包围范围。 */
export interface AnnotationGroup {
  id: string;
  title: string;
  /** 初始创建时圈入的节点 id 集合；运行时以画布实际位置重新计算包围盒。 */
  memberIds: string[];
  style: AnnotationStyle;
}

export const DEFAULT_GROUP_STYLE: AnnotationStyle = {
  borderStyle: 'solid',
  color: '#64748b',
  width: 1.5,
  fill: 'none',
  corner: 'rounded',
};

/** 节点样式（per-node override，优先于主题默认） */
export interface NodeStyle {
  color?: string;
  sizeLevel?: 'xs' | 's' | 'm' | 'l' | 'xl';
}

export interface MindMapCanvasSidecar {
  schemaVersion?: number;
  positions: Record<string, MindMapPosition>;
  /** P0-9: per-node 样式，key 为 positionKey (node.id) */
  nodeStyles: Record<string, NodeStyle>;
  customEdges: CustomFlowEdge[];
  freeLines: FreeFlowLine[];
  groups: AnnotationGroup[];
  edgeMode: EdgeDisplayMode;
  /** 6-8 个常用色 + 用户最近用色。 */
  colorHistory: string[];
}

export const DEFAULT_PALETTE: string[] = [
  '#0ea5e9', // sky
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#64748b', // slate
  '#111827', // near-black
];

const PREFIX = 'folia.mindmap.canvas.v2:';

function storageKey(documentKey: string): string {
  return `${PREFIX}${documentKey}`;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function emptySidecar(): MindMapCanvasSidecar {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    positions: {},
    nodeStyles: {},
    customEdges: [],
    freeLines: [],
    groups: [],
    edgeMode: 'mindmap',
    colorHistory: [],
  };
}

function isPosition(v: unknown): v is MindMapPosition {
  if (!v || typeof v !== 'object') return false;
  const { x, y } = v as { x?: unknown; y?: unknown };
  return typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y);
}

function isCustomEdge(v: unknown): v is CustomFlowEdge {
  if (!v || typeof v !== 'object') return false;
  const e = v as Partial<CustomFlowEdge>;
  return (
    typeof e.id === 'string' &&
    typeof e.source === 'string' &&
    typeof e.target === 'string' &&
    (e.arrow === 'one-way' || e.arrow === 'both' || e.arrow === 'none') &&
    (e.shape === 'straight' || e.shape === 'step') &&
    (e.dash === 'solid' || e.dash === 'dashed') &&
    typeof e.color === 'string' &&
    typeof e.width === 'number' && Number.isFinite(e.width)
  );
}

function isEndpoint(v: unknown): v is FreeFlowEndpoint {
  if (!v || typeof v !== 'object') return false;
  const e = v as Partial<FreeFlowEndpoint>;
  if (e.kind === 'free') {
    return typeof e.x === 'number' && Number.isFinite(e.x) && typeof e.y === 'number' && Number.isFinite(e.y);
  }
  if (e.kind === 'bound') {
    return (
      typeof e.nodeId === 'string' &&
      (e.anchor === 'left' || e.anchor === 'right' || e.anchor === 'top' || e.anchor === 'bottom' || e.anchor === 'center') &&
      (e.x === undefined || typeof e.x === 'number') &&
      (e.y === undefined || typeof e.y === 'number')
    );
  }
  return false;
}

function isFreeLine(v: unknown): v is FreeFlowLine {
  if (!v || typeof v !== 'object') return false;
  const line = v as Partial<FreeFlowLine>;
  return (
    typeof line.id === 'string' &&
    isEndpoint(line.start) &&
    isEndpoint(line.end) &&
    (line.arrow === 'one-way' || line.arrow === 'both' || line.arrow === 'none') &&
    (line.shape === 'straight' || line.shape === 'step') &&
    (line.dash === 'solid' || line.dash === 'dashed') &&
    typeof line.color === 'string' &&
    typeof line.width === 'number' && Number.isFinite(line.width)
  );
}

function isGroup(v: unknown): v is AnnotationGroup {
  if (!v || typeof v !== 'object') return false;
  const g = v as Partial<AnnotationGroup>;
  if (typeof g.id !== 'string' || typeof g.title !== 'string') return false;
  if (!Array.isArray(g.memberIds) || !g.memberIds.every((id) => typeof id === 'string')) return false;
  if (!g.style || typeof g.style !== 'object') return false;
  const s = g.style as Partial<AnnotationStyle>;
  return (
    (s.borderStyle === 'solid' || s.borderStyle === 'dashed') &&
    typeof s.color === 'string' &&
    typeof s.width === 'number' &&
    (s.fill === 'none' || s.fill === 'light') &&
    (s.corner === 'square' || s.corner === 'rounded')
  );
}

function isEdgeMode(v: unknown): v is EdgeDisplayMode {
  return v === 'mindmap' || v === 'flow' || v === 'none';
}

function isNodeStyle(v: unknown): v is NodeStyle {
  if (!v || typeof v !== 'object') return false;
  const s = v as Partial<NodeStyle>;
  if (s.color !== undefined && typeof s.color !== 'string') return false;
  if (s.sizeLevel !== undefined && !(s.sizeLevel === 'xs' || s.sizeLevel === 's' || s.sizeLevel === 'm' || s.sizeLevel === 'l' || s.sizeLevel === 'xl')) return false;
  return true;
}

export function loadCanvasSidecar(
  documentKey: string,
  storage: StorageLike | undefined = defaultStorage(),
): MindMapCanvasSidecar {
  const fallback = emptySidecar();
  if (!documentKey || !storage) return fallback;
  const mergeLegacyPositions = (out: MindMapCanvasSidecar): void => {
    const legacy = loadMindMapPositions(documentKey, storage);
    for (const [key, value] of Object.entries(legacy)) {
      if (!out.positions[key]) out.positions[key] = value;
    }
  };
  try {
    const raw = storage.getItem(storageKey(documentKey));
    if (!raw) {
      mergeLegacyPositions(fallback);
      if (Object.keys(fallback.positions).length > 0) saveCanvasSidecar(documentKey, fallback, storage);
      return fallback;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: MindMapCanvasSidecar = fallback;

    const loadedSchemaVersion = typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 1;

    if (parsed.positions && typeof parsed.positions === 'object') {
      for (const [k, v] of Object.entries(parsed.positions as Record<string, unknown>)) {
        if (isPosition(v)) out.positions[k] = v;
      }
    }
    mergeLegacyPositions(out);
    // P0-9: 加载 per-node 样式
    if (parsed.nodeStyles && typeof parsed.nodeStyles === 'object') {
      for (const [k, v] of Object.entries(parsed.nodeStyles as Record<string, unknown>)) {
        if (isNodeStyle(v)) out.nodeStyles[k] = v;
      }
    }
    if (Array.isArray(parsed.customEdges)) {
      for (const v of parsed.customEdges) {
        if (isCustomEdge(v)) out.customEdges.push(v);
      }
    }
    if (Array.isArray(parsed.freeLines)) {
      for (const v of parsed.freeLines) {
        if (isFreeLine(v)) out.freeLines.push(v);
      }
    }
    if (Array.isArray(parsed.groups)) {
      for (const v of parsed.groups) {
        if (isGroup(v)) out.groups.push(v);
      }
    }
    if (isEdgeMode(parsed.edgeMode)) out.edgeMode = parsed.edgeMode;
    if (Array.isArray(parsed.colorHistory)) {
      out.colorHistory = (parsed.colorHistory as unknown[])
        .filter((c): c is string => typeof c === 'string' && c.length > 0)
        .slice(0, 16);
    }

    if (loadedSchemaVersion < CURRENT_SCHEMA_VERSION) {
      out.schemaVersion = CURRENT_SCHEMA_VERSION;
      saveCanvasSidecar(documentKey, out, storage);
    }

    return out;
  } catch {
    return fallback;
  }
}

export function saveCanvasSidecar(
  documentKey: string,
  sidecar: MindMapCanvasSidecar,
  storage: StorageLike | undefined = defaultStorage(),
): void {
  if (!documentKey || !storage) return;
  try {
    storage.setItem(storageKey(documentKey), JSON.stringify(sidecar));
  } catch {
    // sidecar 可丢弃；存储不可用时不影响画布主功能。
  }
}

/** 把一个颜色加入最近使用队列，置于队首，去重，限长 8。 */
export function recordColor(sidecar: MindMapCanvasSidecar, color: string): void {
  if (!color) return;
  const filtered = sidecar.colorHistory.filter((c) => c !== color);
  filtered.unshift(color);
  sidecar.colorHistory = filtered.slice(0, 8);
}
