export interface MindMapPosition {
  x: number;
  y: number;
}

export type MindMapPositions = Record<string, MindMapPosition>;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const PREFIX = 'folia.mindmap.positions.v1:';

function storageKey(documentKey: string): string {
  return `${PREFIX}${documentKey}`;
}

function defaultStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function loadMindMapPositions(
  documentKey: string,
  storage: StorageLike | undefined = defaultStorage(),
): MindMapPositions {
  if (!documentKey || !storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(documentKey)) ?? '{}') as Record<string, unknown>;
    const positions: MindMapPositions = {};
    for (const [nodeKey, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue;
      const { x, y } = value as { x?: unknown; y?: unknown };
      if (typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)) {
        positions[nodeKey] = { x, y };
      }
    }
    return positions;
  } catch {
    return {};
  }
}

export function saveMindMapPositions(
  documentKey: string,
  positions: MindMapPositions,
  storage: StorageLike | undefined = defaultStorage(),
): void {
  if (!documentKey || !storage) return;
  try {
    storage.setItem(storageKey(documentKey), JSON.stringify(positions));
  } catch {
    // 布局 sidecar 可丢弃；存储不可用时自动布局仍是完整兜底。
  }
}
