/**
 * 脑图主题定义（PRD 项 B）。四套内置简洁直线条主题：
 * 彩色（一级分支轮转配色）/ 蓝色 / 紫色 / 黑白。
 * 形态统一：纯文字节点 + 细线连接，无卡片阴影；根节点仅轻量描边强调。
 */

export type MindMapThemeId = 'simple-color' | 'simple-blue' | 'simple-purple' | 'simple-mono';

export interface MindMapTheme {
  id: MindMapThemeId;
  name: string;
  /** 一级分支轮转色（该分支的节点下划线与连线同色）；单色主题只有一个元素 */
  branchColors: string[];
  /** 节点文字颜色 */
  text: string;
  /** 根节点描边/文字强调色 */
  root: string;
  edgeWidth: number;
}

export const MINDMAP_THEMES: MindMapTheme[] = [
  {
    id: 'simple-blue',
    name: '蓝色',
    branchColors: ['#1d4ed8', '#2563eb', '#3b82f6', '#60a5fa', '#0ea5e9'],
    text: '#1f2937',
    root: '#1d4ed8',
    edgeWidth: 1.5,
  },
  {
    id: 'simple-color',
    name: '彩色',
    branchColors: ['#e11d48', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed'],
    text: '#1f2937',
    root: '#334155',
    edgeWidth: 1.5,
  },
  {
    id: 'simple-purple',
    name: '紫色',
    branchColors: ['#6d28d9', '#7c3aed', '#8b5cf6', '#a78bfa', '#c084fc'],
    text: '#1f2937',
    root: '#6d28d9',
    edgeWidth: 1.5,
  },
  {
    id: 'simple-mono',
    name: '黑白',
    branchColors: ['#111827'],
    text: '#111827',
    root: '#111827',
    edgeWidth: 1.5,
  },
];

export const DEFAULT_THEME_ID: MindMapThemeId = 'simple-blue';

const STORAGE_KEY = 'folia.mindmap.theme';

export function getTheme(id: string | null | undefined): MindMapTheme {
  return MINDMAP_THEMES.find((t) => t.id === id) ?? MINDMAP_THEMES.find((t) => t.id === DEFAULT_THEME_ID)!;
}

/** 分支配色：根节点用 root 色；分支按一级分支下标轮转。 */
export function branchColor(theme: MindMapTheme, branchIndex: number): string {
  if (branchIndex < 0) return theme.root;
  return theme.branchColors[branchIndex % theme.branchColors.length];
}

export function loadThemeId(): MindMapThemeId {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (saved && MINDMAP_THEMES.some((t) => t.id === saved)) return saved as MindMapThemeId;
  } catch {
    // localStorage 不可用（如隐私模式）时静默回退默认
  }
  return DEFAULT_THEME_ID;
}

export function saveThemeId(id: MindMapThemeId): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, id);
  } catch {
    // 持久化失败不影响本次会话内切换
  }
}
