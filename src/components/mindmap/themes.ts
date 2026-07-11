/**
 * 脑图主题定义（PRD 项 B）。四套内置简洁直线条主题：
 * 彩色（一级分支轮转配色）/ 蓝色 / 紫色 / 黑白。
 * 形态统一：小圆角长方形节点 + 直线连接，无卡片阴影；根节点仅以字重和线宽强调。
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
  // 文字色与黑白主题线条色走应用主题 CSS 变量，深色模式下随 --text 自动翻转
  // （Codex R2 P2：硬编码深色文字在深色画布上不可读）；彩色系分支色为中等饱和度，
  // 深浅两种背景下均可读。
  {
    id: 'simple-blue',
    name: '蓝色',
    branchColors: ['#2563eb', '#3b82f6', '#60a5fa', '#0ea5e9', '#38bdf8'],
    text: 'var(--text, #1f2937)',
    root: '#3b82f6',
    edgeWidth: 1.5,
  },
  {
    id: 'simple-color',
    name: '彩色',
    branchColors: ['#e11d48', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed'],
    text: 'var(--text, #1f2937)',
    root: 'var(--text, #334155)',
    edgeWidth: 1.5,
  },
  {
    id: 'simple-purple',
    name: '紫色',
    branchColors: ['#7c3aed', '#8b5cf6', '#a78bfa', '#c084fc'],
    text: 'var(--text, #1f2937)',
    root: '#8b5cf6',
    edgeWidth: 1.5,
  },
  {
    id: 'simple-mono',
    name: '黑白',
    branchColors: ['var(--text, #111827)'],
    text: 'var(--text, #111827)',
    root: 'var(--text, #111827)',
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
