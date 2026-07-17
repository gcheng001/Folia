import { createSourceAnchor } from './source';
import type { MarkdownBlock, TraceableElement, ViewFamily, ViewFit } from './types';

const DATE = /(?:\b(?:19|20)\d{2}[-/.](?:0?[1-9]|1[0-2])(?:[-/.](?:0?[1-9]|[12]\d|3[01]))?\b)|(?:(?:19|20)\d{2}年(?:0?[1-9]|1[0-2])月(?:0?[1-9]|[12]\d|3[01])日?)|(?:(?:19|20)\d{2}年)/;
const TIMELINE_EVENT = /(?:入职|建立|开始|缴纳|停缴|停止|达到|继续工作|发放|支付|签订|解除|终止|离职|申请|受理|开庭|裁决|判决|送达|通知|收到|发生|提交|交付|转账|出具|退休|年满)/;
const TIMELINE_NOISE = /(?:分析日期|请求[①②③④⑤⑥⑦⑧⑨⑩\d]|诉请|本院认为|可能|应当|法条|第\s*\d+\s*条|工龄|时效|计算|争议焦点)/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/;
const NUMBERED_STEP = /^\s*(?:[-+*]\s*)?(?:\d+[.)、]|第[一二三四五六七八九十百零\d]+[步阶段层]|步骤\s*\d+|step\s*\d+)/i;
const DECISION = /(?:如果|若|一旦)\s*([^\n，。；]{2,50}?)(?:，|,|\s)*(?:则|那么|就)\s*([^\n。；]{2,70})/;
const CHART_DATUM = /([^\d\n|：:]{1,30}?)\s*[：:]\s*(-?\d+(?:[,.，]\d{3})*(?:\.\d+)?)\s*(%|％|万元|亿元|元|人|件|次|天|月|年|kg|公里|km)?/g;

type Extraction = { elements: TraceableElement[]; review: string[] };

function anchor(source: string, block: MarkdownBlock, start = block.start, end = block.end) {
  return createSourceAnchor({ source, start, end, blockKind: block.kind, headingPath: block.headingPath });
}

// 反复剥离成对行内强调：加粗、斜体、行内代码、删除线（支持嵌套，外层先剥）
function stripInlineEmphasis(label: string): string {
  let prev: string;
  do {
    prev = label;
    label = label
      .replace(/\*\*([\s\S]+?)\*\*/g, '$1')
      .replace(/__([\s\S]+?)__/g, '$1')
      .replace(/~~([\s\S]+?)~~/g, '$1')
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/\*([^*\n]+)\*/g, '$1')
      .replace(/_([^_\n]+)_/g, '$1');
  } while (label !== prev);
  return label;
}

function cleanBlockLabel(block: MarkdownBlock): string {
  return stripInlineEmphasis(
    block.text
      .replace(/^#{1,6}\s+/, '')
      .replace(/^\s*(?:[-+*]|\d+[.)、])\s+/, '')
      .replace(/\s+#+\s*$/, '')
      .replace(/[:：][^:：\n]*$/, '')
      .trim(),
  );
}

function preferSemanticSection(blocks: MarkdownBlock[], headingPattern: RegExp): MarkdownBlock[] {
  const scoped = blocks.filter((block) => block.headingPath.some((heading) => headingPattern.test(heading)));
  return scoped.length > 0 ? scoped : blocks;
}

function structure(source: string, blocks: MarkdownBlock[]): Extraction {
  const sourceBlocks = blocks.filter((block) => block.kind === 'heading' || block.kind === 'list-item');
  const elements: TraceableElement[] = [];
  const parentAtLevel = new Map<number, string>();
  sourceBlocks.forEach((block, index) => {
    const level = block.headingLevel ?? Math.min(6, block.headingPath.length + 1);
    const id = `structure-${block.start}-${index}`;
    elements.push({
      id,
      kind: 'node',
      label: cleanBlockLabel(block) || '未命名节点',
      anchor: anchor(source, block),
      data: { level, sourceKind: block.kind },
    });
    const parent = [...parentAtLevel.entries()]
      .filter(([candidate]) => candidate < level)
      .sort(([left], [right]) => right - left)[0]?.[1];
    if (parent) {
      elements.push({
        id: `structure-edge-${parent}-${id}`,
        kind: 'edge',
        label: '包含',
        anchor: anchor(source, block),
        data: { from: parent, to: id, relation: 'heading-hierarchy' },
      });
    }
    parentAtLevel.set(level, id);
    [...parentAtLevel.keys()].filter((candidate) => candidate > level).forEach((candidate) => parentAtLevel.delete(candidate));
  });
  return { elements, review: [] };
}

function timeline(source: string, blocks: MarkdownBlock[]): Extraction {
  const candidates: Array<TraceableElement & { sortKey: number }> = [];
  const seen = new Set<string>();
  preferSemanticSection(blocks, /(?:时间线|时间轴|大事记|客观事实|案件经过|事实经过)/)
    .filter((block) => block.kind !== 'fenced-code' && block.kind !== 'frontmatter').forEach((block) => {
    let relative = 0;
    block.text.split('\n').forEach((line) => {
      const match = line.match(DATE);
      if (match) {
        const start = block.start + relative;
        const label = stripInlineEmphasis(line.replace(DATE, '').replace(/^\s*[-#>|+：:,，]+\s*/, '').trim()) || '待补充事件';
        const dateParts = match[0].replace(/[年月/.]/g, '-').replace(/日$/, '').split('-').filter(Boolean).map(Number);
        const year = dateParts[0];
        const month = dateParts[1] ?? 1;
        const day = dateParts[2] ?? 1;
        const sortKey = year * 10_000 + month * 100 + day;
        const dateAtStart = line.slice(0, match.index ?? 0).replace(/[*_`#>|\s-]/g, '').length === 0;
        const usefulFact = TIMELINE_EVENT.test(label) || (dateAtStart && label.length <= 120 && !TIMELINE_NOISE.test(label));
        const dedupeKey = `${sortKey}:${label.replace(/[\s|*，。；;]+/g, '')}`;
        if (!usefulFact || TIMELINE_NOISE.test(label) || seen.has(dedupeKey)) {
          relative += line.length + 1;
          return;
        }
        seen.add(dedupeKey);
        candidates.push({
          id: `timeline-${start}`,
          kind: 'event',
          label,
          anchor: anchor(source, block, start, start + line.length),
          data: { date: match[0], description: label, sortKey },
          sortKey,
        });
      }
      relative += line.length + 1;
    });
  });
  candidates.sort((left, right) => left.sortKey - right.sortKey || left.anchor.start - right.anchor.start);
  return {
    elements: candidates.map((candidate) => ({
      id: candidate.id,
      kind: candidate.kind,
      label: candidate.label,
      anchor: candidate.anchor,
      data: candidate.data,
    })),
    review: [],
  };
}

const RELATIONS: Array<{ regex: RegExp; verb: string }> = [
  { regex: /([\p{L}\p{N}·]{2,24})\s*向\s*([\p{L}\p{N}·]{2,24})\s*(支付|转账|交付|发送|出具)/gu, verb: '流向' },
  { regex: /([\p{L}\p{N}·]{2,24})\s*(?:与|和)\s*([\p{L}\p{N}·]{2,24})\s*(签订|合作|关联|共同)/gu, verb: '关联' },
  { regex: /([\p{L}\p{N}·]{2,24})\s*(属于|隶属于|负责|管理)\s*([\p{L}\p{N}·]{2,24})/gu, verb: '关系' },
];

function relationship(source: string, blocks: MarkdownBlock[]): Extraction {
  const elements: TraceableElement[] = [];
  const nodes = new Map<string, string>();
  const ensureNode = (label: string, block: MarkdownBlock, start: number) => {
    const existing = nodes.get(label);
    if (existing) return existing;
    const id = `relationship-node-${nodes.size}`;
    nodes.set(label, id);
    elements.push({ id, kind: 'node', label, anchor: anchor(source, block, start, start + label.length), data: {} });
    return id;
  };
  preferSemanticSection(blocks, /(?:法律关系|主体关系|当事人|关系对|关系网络)/)
    .filter((block) => !['fenced-code', 'frontmatter'].includes(block.kind)).forEach((block) => {
    const arrow = block.text.match(/[*_`]*([^→➡\n*（）()]{2,30})\s*[→➡]\s*([^（(\n*]{2,30})[*_`]*(?:[（(]([^）)\n]{2,60})[）)])?/);
    if (arrow) {
      const left = arrow[1].trim();
      const right = arrow[2].replace(/[*_`]/g, '').trim();
      const matchStart = arrow.index ?? 0;
      const from = ensureNode(left, block, block.start + matchStart + arrow[0].indexOf(arrow[1]));
      const to = ensureNode(right, block, block.start + matchStart + arrow[0].indexOf(arrow[2]));
      elements.push({
        id: `relationship-edge-arrow-${block.start}-${matchStart}`,
        kind: 'edge',
        label: arrow[3]?.trim() || '关系',
        anchor: anchor(source, block, block.start + matchStart, block.start + matchStart + arrow[0].length),
        data: { from, to },
      });
    }
    RELATIONS.forEach(({ regex, verb }) => {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(block.text))) {
        const thirdPattern = match[3] && ['属于', '隶属于', '负责', '管理'].includes(match[2]);
        const left = match[1];
        const right = thirdPattern ? match[3] : match[2];
        const leftStart = block.start + match.index + match[0].indexOf(left);
        const rightStart = block.start + match.index + match[0].indexOf(right);
        const from = ensureNode(left, block, leftStart);
        const to = ensureNode(right, block, rightStart);
        elements.push({
          id: `relationship-edge-${block.start}-${match.index}`,
          kind: 'edge',
          label: thirdPattern ? match[2] : verb,
          anchor: anchor(source, block, block.start + match.index, block.start + match.index + match[0].length),
          data: { from, to },
        });
      }
    });
  });
  const hasEdge = elements.some((element) => element.kind === 'edge');
  const looksRelational = /(?:向|与|和|属于|隶属于|负责|管理|转账|交付)/.test(source);
  return {
    elements,
    review: !hasEdge && looksRelational ? ['原文出现关系提示词，但主体或方向不够明确，未生成正式关系'] : [],
  };
}

function flow(source: string, blocks: MarkdownBlock[]): Extraction {
  const elements: TraceableElement[] = [];
  let previous: string | null = null;
  preferSemanticSection(blocks, /(?:流程|步骤|检视程式|解题大纲|检索顺序)/)
    .filter((block) => !['fenced-code', 'frontmatter'].includes(block.kind)).forEach((block) => {
    const normalized = cleanBlockLabel(block);
    const stepText = block.text.replace(/^#{1,6}\s+/, '').replace(/\*+/g, '').trim();
    const decision = normalized.match(DECISION);
    if (!NUMBERED_STEP.test(stepText) && !decision) return;
    const id = `flow-node-${block.start}`;
    const label = decision ? `${decision[1].trim()}？${decision[2].trim()}` : normalized;
    elements.push({ id, kind: 'node', label, anchor: anchor(source, block), data: { flowKind: decision ? 'decision' : 'step' } });
    if (previous) elements.push({
      id: `flow-edge-${previous}-${id}`,
      kind: 'edge',
      label: decision ? '条件' : '下一步',
      anchor: anchor(source, block),
      data: { from: previous, to: id },
    });
    previous = id;
  });
  const looksConditional = /(?:如果|若|一旦|然后|随后|下一步)/.test(source);
  return {
    elements,
    review: elements.length === 0 && looksConditional ? ['原文出现流程提示词，但缺少完整步骤或条件结果，未生成正式流程'] : [],
  };
}

function parseCells(line: string): Array<{ text: string; start: number }> {
  const cells: Array<{ text: string; start: number }> = [];
  let cursor = line.startsWith('|') ? 1 : 0;
  const end = line.endsWith('|') ? line.length - 1 : line.length;
  while (cursor < end) {
    const boundary = line.indexOf('|', cursor);
    const segmentEnd = boundary === -1 || boundary > end ? end : boundary;
    const raw = line.slice(cursor, segmentEnd);
    const leading = raw.match(/^\s*/)?.[0].length ?? 0;
    const text = raw.trim();
    cells.push({ text, start: cursor + leading });
    cursor = segmentEnd + 1;
  }
  return cells;
}

function matrix(source: string, blocks: MarkdownBlock[]): Extraction {
  const tableBlocks = blocks.filter((block) => block.kind === 'table').sort((a, b) => a.lineStart - b.lineStart);
  const elements: TraceableElement[] = [];
  let row = 0;
  let header: string[] = [];
  tableBlocks.forEach((block, index) => {
    if (index > 0 && block.lineStart !== tableBlocks[index - 1].lineStart + 1) {
      row = 0;
      header = [];
    }
    if (TABLE_SEPARATOR.test(block.text)) return;
    const cells = parseCells(block.text);
    if (row === 0) header = cells.map((cell) => cell.text);
    cells.forEach((cell, column) => {
      if (!cell.text) return;
      const start = block.start + cell.start;
      elements.push({
        id: `matrix-${block.start}-${column}`,
        kind: 'matrix-cell',
        label: stripInlineEmphasis(cell.text),
        anchor: anchor(source, block, start, start + cell.text.length),
        data: { row, column, header: header[column] ?? `第${column + 1}列` },
      });
    });
    row += 1;
  });
  return { elements, review: [] };
}

function charts(source: string, blocks: MarkdownBlock[]): Extraction {
  const elements: TraceableElement[] = [];
  blocks.filter((block) => !['fenced-code', 'frontmatter'].includes(block.kind)).forEach((block) => {
    CHART_DATUM.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CHART_DATUM.exec(block.text))) {
      const value = Number(match[2].replace(/[,，]/g, ''));
      if (!Number.isFinite(value)) continue;
      const start = block.start + match.index;
      elements.push({
        id: `chart-${start}`,
        kind: 'chart-point',
        label: match[1].trim(),
        anchor: anchor(source, block, start, start + match[0].length),
        data: { value, unit: match[3] ?? '' },
      });
    }
  });
  return { elements, review: [] };
}

export function extractFamily(family: ViewFamily, source: string, blocks: MarkdownBlock[]): Extraction {
  if (family === 'structure-overview') return structure(source, blocks);
  if (family === 'timeline') return timeline(source, blocks);
  if (family === 'relationship') return relationship(source, blocks);
  if (family === 'flow') return flow(source, blocks);
  if (family === 'matrix') return matrix(source, blocks);
  return charts(source, blocks);
}

export function evaluateFamily(family: ViewFamily, source: string, blocks: MarkdownBlock[]): ViewFit {
  const extraction = extractFamily(family, source, blocks);
  const formal = extraction.elements.filter((element) => element.kind !== 'edge').length;
  const edges = extraction.elements.length - formal;
  const minimum = family === 'timeline' || family === 'charts' ? 2 : 1;
  const strongSignalCount = ({
    'structure-overview': 6,
    timeline: 3,
    relationship: 3,
    flow: 3,
    matrix: 6,
    charts: 4,
  } as const)[family];
  const graphFamily = family === 'structure-overview' || family === 'relationship' || family === 'flow';
  const coverage = Math.min(1, formal / strongSignalCount);
  const connectivity = graphFamily && formal > 1 ? Math.min(1, edges / (formal - 1)) : 0;
  const score = formal === 0
    ? (family === 'structure-overview' && source.trim() ? 24 : 0)
    : Math.max(0, Math.min(92, Math.round(31 + coverage * 48 + connectivity * 12 - extraction.review.length * 8)));
  return {
    family,
    score,
    evidence: [
      { code: 'formal-element-count', label: '可追溯元素', count: formal },
      { code: 'explicit-edge-count', label: '明确连接', count: edges },
    ],
    missing: formal >= minimum ? [] : [`至少需要 ${minimum} 个可追溯元素`],
    review: extraction.review,
  };
}
