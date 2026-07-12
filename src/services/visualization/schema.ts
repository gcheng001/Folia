import type { JsonValue, ReviewItem, SourceAnchor, TraceableElement, VisualAnnotation, VisualSheet, VisualWorkbook } from './types';
import { fingerprint, resolveSourceAnchor } from './source';

export const VISUAL_WORKBOOK_KIND = 'folia.visual.workbook' as const;
export const VISUAL_WORKBOOK_SCHEMA_VERSION = 1 as const;
export const VISUALIZATION_RULES_VERSION = '1.3.0' as const;

export class VisualWorkbookValidationError extends Error {
  readonly issues: Array<{ path: string; message: string }>;

  constructor(issues: Array<{ path: string; message: string }>) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
    this.name = 'VisualWorkbookValidationError';
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const VIEW_FAMILIES = new Set(['structure-overview', 'timeline', 'relationship', 'flow', 'matrix', 'charts']);

function validateAnchor(value: unknown, path: string, issues: Array<{ path: string; message: string }>): void {
  if (!isRecord(value)) {
    issues.push({ path, message: '正式元素必须包含来源锚点' });
    return;
  }
  for (const field of ['excerpt', 'excerptHash', 'blockKind'] as const) {
    if (typeof value[field] !== 'string') issues.push({ path: `${path}.${field}`, message: '必须是字符串' });
  }
  for (const field of ['start', 'end'] as const) {
    if (typeof value[field] !== 'number' || !Number.isInteger(value[field]) || value[field] < 0) {
      issues.push({ path: `${path}.${field}`, message: '必须是非负整数' });
    }
  }
  if (typeof value.start === 'number' && typeof value.end === 'number' && value.end <= value.start) {
    issues.push({ path, message: '锚点 end 必须大于 start' });
  }
  if (!Array.isArray(value.headingPath) || !value.headingPath.every((item) => typeof item === 'string')) {
    issues.push({ path: `${path}.headingPath`, message: '必须是字符串数组' });
  }
  if (typeof value.excerpt === 'string' && typeof value.excerptHash === 'string' && fingerprint(value.excerpt) !== value.excerptHash) {
    issues.push({ path: `${path}.excerptHash`, message: '与原文摘录不匹配' });
  }
}

export function parseVisualWorkbook(input: string | unknown): VisualWorkbook {
  let value: unknown = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input) as unknown;
    } catch (error) {
      throw new VisualWorkbookValidationError([{
        path: '$',
        message: `JSON 无法解析：${error instanceof Error ? error.message : String(error)}`,
      }]);
    }
  }

  const issues: Array<{ path: string; message: string }> = [];
  if (!isRecord(value)) throw new VisualWorkbookValidationError([{ path: '$', message: '必须是对象' }]);
  if (value.kind !== VISUAL_WORKBOOK_KIND) issues.push({ path: '$.kind', message: '不是 Folia 可视化工作簿' });
  if (value.schemaVersion !== VISUAL_WORKBOOK_SCHEMA_VERSION) issues.push({ path: '$.schemaVersion', message: '不支持的协议版本' });
  if (typeof value.rulesVersion !== 'string') issues.push({ path: '$.rulesVersion', message: '必须是字符串' });
  if (typeof value.title !== 'string') issues.push({ path: '$.title', message: '必须是字符串' });
  if (!Array.isArray(value.sheets)) issues.push({ path: '$.sheets', message: '必须是数组' });
  if (!(value.activeSheetId === null || typeof value.activeSheetId === 'string')) issues.push({ path: '$.activeSheetId', message: '必须是字符串或 null' });
  if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)) issues.push({ path: '$.createdAt', message: '必须是有限数字' });
  if (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)) issues.push({ path: '$.updatedAt', message: '必须是有限数字' });

  if (!isRecord(value.source)) {
    issues.push({ path: '$.source', message: '必须是对象' });
  } else {
    if (typeof value.source.relativePath !== 'string') issues.push({ path: '$.source.relativePath', message: '必须是字符串' });
    if (value.source.absolutePath !== undefined && typeof value.source.absolutePath !== 'string') issues.push({ path: '$.source.absolutePath', message: '必须是字符串' });
    if (typeof value.source.contentHash !== 'string') issues.push({ path: '$.source.contentHash', message: '必须是字符串' });
  }

  if (Array.isArray(value.sheets)) {
    value.sheets.forEach((sheet, index) => {
      const path = `$.sheets[${index}]`;
      if (!isRecord(sheet)) {
        issues.push({ path, message: '必须是对象' });
        return;
      }
      for (const field of ['id', 'family', 'templateId', 'name'] as const) {
        if (typeof sheet[field] !== 'string') issues.push({ path: `${path}.${field}`, message: '必须是字符串' });
      }
      if (typeof sheet.family === 'string' && !VIEW_FAMILIES.has(sheet.family)) {
        issues.push({ path: `${path}.family`, message: '未知视图家族' });
      }
      for (const field of ['elements', 'annotations', 'reviewItems'] as const) {
        if (!Array.isArray(sheet[field])) issues.push({ path: `${path}.${field}`, message: '必须是数组' });
      }
      if (Array.isArray(sheet.elements)) {
        sheet.elements.forEach((element, elementIndex) => {
          const elementPath = `${path}.elements[${elementIndex}]`;
          if (!isRecord(element)) {
            issues.push({ path: elementPath, message: '必须是对象' });
            return;
          }
          for (const field of ['id', 'kind', 'label'] as const) {
            if (typeof element[field] !== 'string') issues.push({ path: `${elementPath}.${field}`, message: '必须是字符串' });
          }
          if (!isRecord(element.data)) issues.push({ path: `${elementPath}.data`, message: '必须是对象' });
          validateAnchor(element.anchor, `${elementPath}.anchor`, issues);
        });
      }
      for (const field of ['presentation', 'layout'] as const) {
        if (!isRecord(sheet[field])) issues.push({ path: `${path}.${field}`, message: '必须是对象' });
      }
      for (const field of ['createdAt', 'updatedAt'] as const) {
        if (typeof sheet[field] !== 'number' || !Number.isFinite(sheet[field])) issues.push({ path: `${path}.${field}`, message: '必须是有限数字' });
      }
    });
  }

  if (issues.length > 0) throw new VisualWorkbookValidationError(issues);
  // 未知字段留在原对象中，不做 parse→rebuild，以便未来版本前向兼容。
  return value as unknown as VisualWorkbook;
}

export function serializeVisualWorkbook(workbook: VisualWorkbook): string {
  parseVisualWorkbook(workbook);
  return `${JSON.stringify(workbook, null, 2)}\n`;
}

export function createEmptyVisualWorkbook(input: {
  title: string;
  relativeSourcePath: string;
  sourceHash: string;
  absoluteSourcePath?: string;
  now?: number;
}): VisualWorkbook {
  const now = input.now ?? Date.now();
  return {
    kind: VISUAL_WORKBOOK_KIND,
    schemaVersion: VISUAL_WORKBOOK_SCHEMA_VERSION,
    rulesVersion: VISUALIZATION_RULES_VERSION,
    source: { relativePath: input.relativeSourcePath, absolutePath: input.absoluteSourcePath, contentHash: input.sourceHash },
    title: input.title,
    sheets: [],
    activeSheetId: null,
    createdAt: now,
    updatedAt: now,
  };
}

export interface LenientImportResult {
  workbook: VisualWorkbook;
  /** 因锚点无法定位而被降级为 ReviewItem 的元素数 */
  demotedCount: number;
}

function isValidExternalAnchor(value: unknown): value is { excerpt: string } {
  return isRecord(value) && typeof value.excerpt === 'string' && value.excerpt.length > 0;
}

function demoteToReviewItem(
  element: Record<string, unknown>,
  reason: ReviewItem['reason'],
  candidateAnchors: SourceAnchor[],
): ReviewItem {
  const label = typeof element.label === 'string' ? element.label : '未知元素';
  const explanations: Record<ReviewItem['reason'], string> = {
    incomplete: '元素缺少来源摘录（excerpt），无法定位其在原文中的位置。',
    inferred: '元素内容为推测所得，需人工确认。',
    ambiguous: '元素来源摘录（excerpt）在原文中出现多次，位置不唯一。',
    unsupported: '元素在源 Markdown 中未找到匹配的原文摘录。',
  };
  return {
    id: typeof element.id === 'string' ? element.id : `review-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    reason,
    label,
    explanation: explanations[reason],
    candidateAnchors,
  };
}

function processElement(
  element: Record<string, unknown>,
  sourceMarkdown: string,
  index: number,
): { element: TraceableElement | null; reviewItem: ReviewItem | null } {
  if (!isValidExternalAnchor(element.anchor)) {
    const reviewItem = demoteToReviewItem(element, 'incomplete', []);
    return { element: null, reviewItem };
  }

  const anchorRecord = element.anchor as Record<string, unknown>;
  const excerpt: string = anchorRecord.excerpt as string;
  const computedHash = fingerprint(excerpt);
  const parsedAnchor: SourceAnchor = {
    excerpt,
    excerptHash: computedHash,
    start: typeof anchorRecord.start === 'number' ? anchorRecord.start : 0,
    end: typeof anchorRecord.end === 'number' ? anchorRecord.end : excerpt.length,
    blockKind: (anchorRecord.blockKind as SourceAnchor['blockKind']) ?? 'paragraph',
    headingPath: Array.isArray(anchorRecord.headingPath)
      ? (anchorRecord.headingPath as string[])
      : [],
  };

  const resolution = resolveSourceAnchor(parsedAnchor, sourceMarkdown);
  if (resolution.status === 'valid' || resolution.status === 'relocated') {
    const traceable: TraceableElement = {
      id: typeof element.id === 'string' ? element.id : `element-${Date.now()}-${index}`,
      kind: (element.kind as TraceableElement['kind']) ?? 'node',
      label: typeof element.label === 'string' ? element.label : '未知',
      anchor: resolution.anchor,
      data: (element.data as Record<string, JsonValue>) ?? {},
    };
    return { element: traceable, reviewItem: null };
  }

  // missing 或 ambiguous：降级为 ReviewItem
  const reason: ReviewItem['reason'] = resolution.status === 'missing' ? 'unsupported' : 'ambiguous';
  const reviewItem = demoteToReviewItem(element, reason, [resolution.anchor]);
  return { element: null, reviewItem };
}

function processSheet(
  sheet: Record<string, unknown>,
  sourceMarkdown: string,
  sheetIndex: number,
): { sheet: VisualSheet; demotedCount: number } {
  const now = Date.now();
  const elements = (Array.isArray(sheet.elements) ? sheet.elements : []) as Record<string, unknown>[];
  let demotedCount = 0;

  const processedElements: TraceableElement[] = [];
  const reviewItems: ReviewItem[] = [];

  elements.forEach((element, elementIndex) => {
    const { element: traceable, reviewItem } = processElement(element, sourceMarkdown, sheetIndex * 1000 + elementIndex);
    if (traceable) {
      processedElements.push(traceable);
    } else if (reviewItem) {
      reviewItems.push(reviewItem);
      demotedCount++;
    }
  });

  const sheetId = typeof sheet.id === 'string' && sheet.id
    ? sheet.id
    : `sheet-${sheetIndex}`;

  const visualSheet: VisualSheet = {
    id: sheetId,
    family: ((sheet.family as string) ?? 'structure-overview') as VisualSheet['family'],
    templateId: typeof sheet.templateId === 'string' ? sheet.templateId : sheetId,
    name: typeof sheet.name === 'string' ? sheet.name : `工作表 ${sheetIndex + 1}`,
    elements: processedElements,
    annotations: Array.isArray(sheet.annotations) ? sheet.annotations as VisualAnnotation[] : [],
    reviewItems,
    presentation: (isRecord(sheet.presentation) ? sheet.presentation : {}) as VisualSheet['presentation'],
    layout: (isRecord(sheet.layout) ? sheet.layout : {}) as VisualSheet['layout'],
    createdAt: typeof sheet.createdAt === 'number' ? sheet.createdAt : now,
    updatedAt: typeof sheet.updatedAt === 'number' ? sheet.updatedAt : now,
  };

  return { sheet: visualSheet, demotedCount };
}

/**
 * 宽容导入：接受外部 AI agent 生成的 .foliaviz 文件，
 * 以 excerpt 为准重新计算锚点字段，定位失败的元素降级为 ReviewItem，不拒绝整个文件。
 */
export function importExternalWorkbook(
  input: string | unknown,
  sourceMarkdown: string,
): LenientImportResult {
  let value: unknown = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input) as unknown;
    } catch (error) {
      throw new VisualWorkbookValidationError([{
        path: '$',
        message: `JSON 无法解析：${error instanceof Error ? error.message : String(error)}`,
      }]);
    }
  }

  if (!isRecord(value)) throw new VisualWorkbookValidationError([{ path: '$', message: '必须是对象' }]);
  if (value.kind !== VISUAL_WORKBOOK_KIND) {
    throw new VisualWorkbookValidationError([{ path: '$.kind', message: '不是 Folia 可视化工作簿' }]);
  }
  if (value.schemaVersion !== VISUAL_WORKBOOK_SCHEMA_VERSION) {
    throw new VisualWorkbookValidationError([{ path: '$.schemaVersion', message: '不支持的协议版本' }]);
  }
  if (typeof value.rulesVersion !== 'string' || value.rulesVersion.length === 0) {
    throw new VisualWorkbookValidationError([{ path: '$.rulesVersion', message: '必须是非空字符串' }]);
  }

  const now = Date.now();
  const workbookValue = value as Record<string, unknown>;

  const sheets = Array.isArray(workbookValue.sheets) ? workbookValue.sheets as Record<string, unknown>[] : [];
  let totalDemoted = 0;

  const processedSheets: VisualSheet[] = sheets.map((sheet, index) => {
    const { sheet: processed, demotedCount } = processSheet(sheet, sourceMarkdown, index);
    totalDemoted += demotedCount;
    return processed;
  });

  const workbook: VisualWorkbook = {
    kind: VISUAL_WORKBOOK_KIND,
    schemaVersion: VISUAL_WORKBOOK_SCHEMA_VERSION,
    rulesVersion: workbookValue.rulesVersion as string,
    source: isRecord(workbookValue.source)
      ? {
          relativePath: typeof workbookValue.source.relativePath === 'string' ? workbookValue.source.relativePath : '',
          absolutePath: typeof workbookValue.source.absolutePath === 'string' ? workbookValue.source.absolutePath : undefined,
          contentHash: typeof workbookValue.source.contentHash === 'string' ? workbookValue.source.contentHash : '',
        }
      : { relativePath: '', contentHash: '' },
    title: typeof workbookValue.title === 'string' ? workbookValue.title : '未命名',
    sheets: processedSheets,
    activeSheetId: workbookValue.activeSheetId === null || typeof workbookValue.activeSheetId === 'string'
      ? workbookValue.activeSheetId as string | null
      : null,
    createdAt: typeof workbookValue.createdAt === 'number' ? workbookValue.createdAt : now,
    updatedAt: typeof workbookValue.updatedAt === 'number' ? workbookValue.updatedAt : now,
  };

  return { workbook, demotedCount: totalDemoted };
}
