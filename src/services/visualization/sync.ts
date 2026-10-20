import { extractFamily } from './families';
import { VISUALIZATION_RULES_VERSION } from './schema';
import { fingerprint, parseMarkdownBlocks, resolveSourceAnchor } from './source';
import type { TraceableElement, VisualSheet, VisualWorkbook } from './types';

export interface SourceCorrection {
  elementId: string;
  before: string;
  after: string;
  sourceBefore: string;
  sourceAfter: string;
  start: number;
  end: number;
}

export function buildSourceCorrection(
  element: TraceableElement,
  displayLabel: string,
  source: string,
): SourceCorrection | null {
  const resolution = resolveSourceAnchor(element.anchor, source);
  if (resolution.status === 'missing' || resolution.status === 'ambiguous') return null;
  const resolved = resolution.anchor;
  const excerpt = source.slice(resolved.start, resolved.end);
  const occurrences = excerpt.split(element.label).length - 1;
  if (!element.label || occurrences !== 1 || displayLabel === element.label) return null;
  const after = excerpt.replace(element.label, displayLabel);
  return {
    elementId: element.id,
    before: excerpt,
    after,
    sourceBefore: source,
    sourceAfter: `${source.slice(0, resolved.start)}${after}${source.slice(resolved.end)}`,
    start: resolved.start,
    end: resolved.end,
  };
}

function matchElement(next: TraceableElement, previous: TraceableElement[], used: Set<string>): TraceableElement | undefined {
  const candidates = previous.filter((element) => element.kind === next.kind && !used.has(element.id));
  return candidates.find((element) => element.anchor.excerptHash === next.anchor.excerptHash)
    ?? candidates.find((element) => element.label === next.label)
    ?? (next.kind === 'matrix-cell'
      ? candidates.find((element) => element.data.row === next.data.row && element.data.column === next.data.column)
      : undefined);
}

function refreshSheet(sheet: VisualSheet, source: string, now: number): VisualSheet {
  const extracted = extractFamily(sheet.family, source, parseMarkdownBlocks(source));
  const used = new Set<string>();
  const idMap = new Map<string, string>();
  const elements = extracted.elements.map((element) => {
    const previous = matchElement(element, sheet.elements, used);
    if (!previous) return element;
    used.add(previous.id);
    idMap.set(element.id, previous.id);
    return { ...element, id: previous.id };
  }).map((element) => {
    if (element.kind !== 'edge') return element;
    const from = typeof element.data.from === 'string' ? idMap.get(element.data.from) ?? element.data.from : element.data.from;
    const to = typeof element.data.to === 'string' ? idMap.get(element.data.to) ?? element.data.to : element.data.to;
    return { ...element, data: { ...element.data, from, to } };
  });
  const removed = sheet.elements.filter((element) => !used.has(element.id)).length;
  return {
    ...sheet,
    elements,
    reviewItems: [
      ...extracted.review.map((explanation, index) => ({
        id: `review-refresh-${index}`,
        reason: 'ambiguous' as const,
        label: '需要确认',
        explanation,
        candidateAnchors: [],
      })),
      ...(removed > 0 ? [{
        id: 'review-removed-elements',
        reason: 'incomplete' as const,
        label: `${removed} 个旧元素未能重新绑定`,
        explanation: '原文发生变化，旧元素未自动覆盖；请人工审阅后再处理。',
        candidateAnchors: [],
      }] : []),
    ],
    updatedAt: now,
  };
}

export function refreshWorkbookFromSource(workbook: VisualWorkbook, source: string, now = Date.now()): VisualWorkbook {
  return {
    ...workbook,
    rulesVersion: VISUALIZATION_RULES_VERSION,
    source: { ...workbook.source, contentHash: fingerprint(source) },
    sheets: workbook.sheets.map((sheet) => refreshSheet(sheet, source, now)),
    updatedAt: now,
  };
}
