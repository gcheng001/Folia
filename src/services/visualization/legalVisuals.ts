// 内化自上游 legal-skills v0.6.14（commit 48aedb4）references/legal-visual-constants.md
// 同步保留 v1 资源文件（src-tauri/skills/legal-visualization/visual-constants-v1.md）。
// 修改前请先校对资源文件并更新版本号。
// 决策记录见 docs/adr/0022-internalize-legal-visualization-knowledge.md。
// 上游许可证 CC-BY-NC，Folia 与上游同一作者授权复用。

export type LegalPalette = {
  primary: string;
  primaryLight: string;
  accentDecision: string;
  accentDecisionLight: string;
  accentDispute: string;
  accentDisputeLight: string;
  greyMissing: string;
  greyMissingLight: string;
  lineSolid: string;
  lineDashed: string;
  lineDotted: string;
  textPrimary: string;
  textCaption: string;
  frame: string;
  frameBg: string;
};

// 与 visual-constants-v1.md 中 palette 块一一对应。
export const LEGAL_PALETTE: LegalPalette = {
  primary: '#1f77b4',
  primaryLight: '#E3F2FD',
  accentDecision: '#FF8C00',
  accentDecisionLight: '#FFF3E0',
  accentDispute: '#C0392B',
  accentDisputeLight: '#FDECEA',
  greyMissing: '#9E9E9E',
  greyMissingLight: '#F5F5F5',
  lineSolid: '#333333',
  lineDashed: '#666666',
  lineDotted: '#9E9E9E',
  textPrimary: '#1a1a2e',
  textCaption: '#757575',
  frame: '#BDBDBD',
  frameBg: '#F5F5F5',
};

export type LegalFontSizes = {
  titlePt: number;
  subtitlePt: number;
  nodePt: number;
  captionPt: number;
  legendPt: number;
  family: string;
};

// 与 visual-constants-v1.md 中 font 块一一对应。
export const LEGAL_FONT_SIZES: LegalFontSizes = {
  titlePt: 24,
  subtitlePt: 14,
  nodePt: 14,
  captionPt: 12,
  legendPt: 10,
  family: '"Microsoft YaHei", "SimHei", "PingFang SC", sans-serif',
};

export type NodeSizing = {
  width: number;
  height: number;
  hGap: number;
  vGap: number;
};

// 三档节点尺寸，与 visual-constants-v1.md 中"节点尺寸参考"表一一对应。
const TIER_A: NodeSizing = { width: 160, height: 70, hGap: 220, vGap: 160 };
const TIER_B: NodeSizing = { width: 140, height: 60, hGap: 180, vGap: 130 };
const TIER_C: NodeSizing = { width: 120, height: 50, hGap: 150, vGap: 110 };

export function nodeSizing(nodeCount: number): NodeSizing {
  if (nodeCount <= 7) return TIER_A;
  if (nodeCount <= 15) return TIER_B;
  return TIER_C;
}

// 中文节点宽度公式（来自 visual-constants-v1.md）：字符数 × 16px，最小宽 × 1.3，
// 最大 350px。上游 XML 注释给的是 ASCII 范围；这里对 CJK 字符计数，英文按 0.6 字符计，
// 以贴合"中文宽度公式"的意图。
export function chineseNodeWidth(rawText: string, sizing: NodeSizing): number {
  let weight = 0;
  for (const char of rawText) {
    // CJK 统一汉字 + 全角标点都按 1 字符算；其他按 0.6 计。
    const code = char.codePointAt(0) ?? 0;
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      weight += 1;
    } else {
      weight += 0.6;
    }
  }
  const base = Math.ceil(weight * 16);
  const minWidth = Math.ceil(sizing.width * 1.3);
  const maxWidth = 350;
  return Math.min(maxWidth, Math.max(minWidth, base));
}

export type EdgeStatus = 'confirmed' | 'disputed' | 'asserted' | 'inferred' | 'missing';

// 与 visual-constants-v1.md 中"线型与状态绑定"表一一对应；缺省视作 confirmed。
export type EdgeStatusStyle = {
  status: EdgeStatus;
  labelPrefix: string;
  stroke: string;
  dash: number[]; // SVG stroke-dasharray；实线用空数组表示
  emphasis: 'normal' | 'accent';
};

const CONFIRMED: EdgeStatusStyle = {
  status: 'confirmed',
  labelPrefix: '',
  stroke: LEGAL_PALETTE.lineSolid,
  dash: [],
  emphasis: 'normal',
};
const DISPUTED: EdgeStatusStyle = {
  status: 'disputed',
  labelPrefix: '争议',
  stroke: LEGAL_PALETTE.accentDispute,
  dash: [6, 4],
  emphasis: 'accent',
};
const ASSERTED: EdgeStatusStyle = {
  status: 'asserted',
  labelPrefix: '主张',
  stroke: LEGAL_PALETTE.primary,
  dash: [6, 4],
  emphasis: 'normal',
};
const INFERRED: EdgeStatusStyle = {
  status: 'inferred',
  labelPrefix: '推定',
  stroke: LEGAL_PALETTE.lineDotted,
  dash: [2, 3],
  emphasis: 'normal',
};
const MISSING: EdgeStatusStyle = {
  status: 'missing',
  labelPrefix: '待补充',
  stroke: LEGAL_PALETTE.greyMissing,
  dash: [4, 4],
  emphasis: 'normal',
};

export const EDGE_STATUS_STYLES: Record<EdgeStatus, EdgeStatusStyle> = {
  confirmed: CONFIRMED,
  disputed: DISPUTED,
  asserted: ASSERTED,
  inferred: INFERRED,
  missing: MISSING,
};

export function edgeStatusStyle(status: string | undefined): EdgeStatusStyle {
  if (!status) return CONFIRMED;
  const known = EDGE_STATUS_STYLES[status as EdgeStatus];
  return known ?? CONFIRMED;
}

// 画布原点偏移（visual-constants-v1.md 中 page.origin）。
export const LEGAL_CANVAS_ORIGIN = { x: 60, y: 80 } as const;

// 中文宽度系数与节点最大宽，导出供单测和 layout.ts 复用。
export const LEGAL_CJK_WIDTH_PX = 16;
export const LEGAL_NODE_MIN_WIDTH_MULTIPLIER = 1.3;
export const LEGAL_NODE_MAX_WIDTH_PX = 350;

// 导出 CSS 变量键名映射，便于 CSS 端直接 var(--legal-*) 引用。
export const LEGAL_CSS_VAR_NAMES: Record<keyof LegalPalette, string> = {
  primary: '--legal-primary',
  primaryLight: '--legal-primary-light',
  accentDecision: '--legal-accent-decision',
  accentDecisionLight: '--legal-accent-decision-light',
  accentDispute: '--legal-accent-dispute',
  accentDisputeLight: '--legal-accent-dispute-light',
  greyMissing: '--legal-grey-missing',
  greyMissingLight: '--legal-grey-missing-light',
  lineSolid: '--legal-line-solid',
  lineDashed: '--legal-line-dashed',
  lineDotted: '--legal-line-dotted',
  textPrimary: '--legal-text-primary',
  textCaption: '--legal-text-caption',
  frame: '--legal-frame',
  frameBg: '--legal-frame-bg',
};

export function legalPaletteCssVars(): string {
  return Object.entries(LEGAL_PALETTE)
    .map(([key, value]) => `${LEGAL_CSS_VAR_NAMES[key as keyof LegalPalette]}: ${value};`)
    .join('\n  ');
}