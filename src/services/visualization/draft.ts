import { extractFamily } from './families';
import { VISUALIZATION_RULES_VERSION, VISUAL_WORKBOOK_KIND, VISUAL_WORKBOOK_SCHEMA_VERSION } from './schema';
import { evaluateViews, recommendView } from './router';
import { fingerprint, parseMarkdownBlocks } from './source';
import type { MarkdownBlock, ViewFamily, VisualSheet, VisualWorkbook } from './types';

function sheetName(family: ViewFamily): string {
  return ({
    'structure-overview': '结构总览',
    timeline: '时间轴',
    relationship: '关系网络',
    flow: '流程与决策',
    matrix: '矩阵与对比',
    charts: '数值图表',
  } as const)[family];
}

function createSheet(family: ViewFamily, source: string, blocks: MarkdownBlock[], now: number): VisualSheet {
  const extracted = extractFamily(family, source, blocks);
  const reviewExplanations = extracted.review.length > 0
    ? extracted.review
    : extracted.elements.length === 0
      ? ['原文缺少足够的明确结构，未生成正式元素']
      : [];
  return {
    id: `sheet-${family}`,
    family,
    templateId: family,
    name: sheetName(family),
    elements: extracted.elements,
    annotations: [],
    reviewItems: reviewExplanations.map((explanation, index) => ({
      id: `review-${family}-${index}`,
      reason: 'ambiguous' as const,
      label: '需要确认',
      explanation,
      candidateAnchors: [],
    })),
    presentation: {},
    layout: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function visualizationDraftName(sourceName: string): string {
  const stem = sourceName.replace(/\.(?:md|markdown)$/i, '') || '未命名';
  return `${stem}.foliaviz`;
}

export function createVisualWorkbookDraft(input: { markdown: string; sourceName: string; sourcePath?: string; now?: number }): VisualWorkbook {
  const now = input.now ?? Date.now();
  const recommendation = recommendView(input.markdown);
  const blocks = parseMarkdownBlocks(input.markdown);
  const primary = recommendation.primary.family;
  const sheets = [createSheet(primary, input.markdown, blocks, now)];
  return {
    kind: VISUAL_WORKBOOK_KIND,
    schemaVersion: VISUAL_WORKBOOK_SCHEMA_VERSION,
    rulesVersion: VISUALIZATION_RULES_VERSION,
    source: { relativePath: input.sourceName, absolutePath: input.sourcePath || undefined, contentHash: fingerprint(input.markdown) },
    title: input.sourceName.replace(/\.(?:md|markdown)$/i, '') || '未命名可视化',
    recommendation: {
      mode: recommendation.mode,
      fits: evaluateViews(input.markdown).filter((fit) => fit.score > 0).slice(0, 3),
    },
    sheets,
    activeSheetId: sheets[0].id,
    createdAt: now,
    updatedAt: now,
  };
}

export function addRecommendedSheet(workbook: VisualWorkbook, family: ViewFamily, source = '', now = Date.now()): VisualWorkbook {
  if (workbook.sheets.some((sheet) => sheet.family === family)) return workbook;
  const blocks = source ? parseMarkdownBlocks(source) : [];
  const sheet = createSheet(family, source, blocks, now);
  if (source) {
    return { ...workbook, sheets: [...workbook.sheets, sheet], activeSheetId: sheet.id, updatedAt: now };
  }
  sheet.reviewItems = [{
    id: `review-${family}`,
    reason: 'unsupported',
    label: `${sheetName(family)}等待重新绑定原文`,
    explanation: '工作簿不保存 Markdown 正文；请在后续同步审阅中从绑定原文安全抽取。',
    candidateAnchors: [],
  }];
  return { ...workbook, sheets: [...workbook.sheets, sheet], activeSheetId: sheet.id, updatedAt: now };
}
