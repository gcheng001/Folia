/**
 * Markdown → MindMapDoc 解析器（CST 式：保留原文行，不丢内容）。
 *
 * 树构建（markmap 约定，标题+列表混合）：
 * - ATX 标题 `#{1,6}` → outline 深度 = # 数。
 * - 列表项 `- * + 1.` → 深度 = 最近上级 outline 深度 + 1 + 缩进层级。
 * - 维护一个节点栈，新节点弹栈到「栈顶深度 < 新深度」后挂为子节点。
 * - 非大纲行（段落/代码块/表格/引用/空行）不产生节点，落入所在节点
 *   的「owned 行区间」（由 lineIndex 决定，序列化时原样拼回）。
 * - 代码块（``` / ~~~）内的 `#` 与 `-` 不识别为大纲。
 *
 * 往返保证不靠完美建树，而靠「每个节点记 lineIndex + 原文 lines 逐行拼回」。
 * 见 serializer.ts。
 */

import type {
  EvidenceStatus,
  EvidenceVerdict,
  MindMapDoc,
  MindNode,
  NodeType,
} from './types';

const ATX_HEADING = /^(#{1,6})\s+(.*)$/;
/** 无序与有序列表项；有序只取序号占位，深度按缩进算。捕获 marker 后空白以精确算内容列。 */
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/;
const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})(.*)$/;
const FRONTMATTER_DELIM = /^---\s*$/;
/** 主题分隔线：3+ 同字符（- * _）以空格分隔，整行匹配。 */
const THEMATIC_BREAK = /^(\s*)([-*_])(?:\s*\2){2,}\s*$/;
const STANDALONE_EMPHASIS = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/;
const CHINESE_SECTION = /^(?:第[一二三四五六七八九十百千0-9]+(?:部分|篇|章|节)|[一二三四五六七八九十百千]+[、.．])\s*/;
const PAREN_SECTION = /^[（(][一二三四五六七八九十百千0-9]+[）)]\s*/;
const DECIMAL_SECTION = /^(\d+(?:\.\d+)+)[、.．]?\s*/;
const SHORT_LABEL = /^[^。！？；.!?]{2,36}[：:]$/;

const TYPE_VOCAB: NodeType[] = ['要件', '争点', '证据', '法条', '事实', '质证'];
const EVIDENCE_VERDICTS: EvidenceVerdict[] = ['认可', '不认可', '部分认可'];
const EVIDENCE_ASPECTS = ['真实性', '合法性', '关联性'] as const;

/** 缩进代码块的最小余量：行缩进超过所在列表项内容列至少 4 列才是代码块（CommonMark）。
 *  历史上曾用固定 2-space 步长算嵌套深度，对 `1. a /  - child` 等宽窄不齐的列表
 *  会把 child 强行挂到 a 下；现按父项内容列判定（见 R6-P0-1）。 */
const INDENT_INDENT = 4;

/** tab 展开步长（CommonMark：tab 展开到下一个 4 列停靠位）。 */
const TAB_STOP = 4;

/** 前导空白按列宽展开（tab → 下一个 4 列停靠位），返回内容起始列。编辑内核复用同一规则。 */
export function expandCols(ws: string, startCol = 0): number {
  let col = startCol;
  for (const ch of ws) {
    col = ch === '\t' ? (Math.floor(col / TAB_STOP) + 1) * TAB_STOP : col + 1;
  }
  return col;
}

function makeNode(kind: MindNode['kind'], level: number, text: string, lineIndex: number): MindNode {
  return {
    id: '',
    kind,
    level,
    text,
    body: '',
    projections: [],
    children: [],
    types: [],
    tags: [],
    refs: [],
    links: [],
    lineIndex,
  };
}

interface InferredLine {
  lineIndex: number;
  level: number;
  text: string;
}

function cleanInferredText(line: string): string {
  const trimmed = line.trim();
  const emphasized = trimmed.match(STANDALONE_EMPHASIS);
  return (emphasized?.[1] ?? trimmed)
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();
}

function inferredRank(line: string): number | null {
  const text = cleanInferredText(line);
  if (CHINESE_SECTION.test(text)) return 1;
  if (PAREN_SECTION.test(text)) return 2;
  const decimal = text.match(DECIMAL_SECTION);
  if (decimal) return Math.min(5, decimal[1].split('.').length);
  if (STANDALONE_EMPHASIS.test(line) || SHORT_LABEL.test(text)) return 1;
  return null;
}

function inferableProseLine(line: string): boolean {
  const text = line.trim();
  if (!text || text.length < 2) return false;
  if (
    ATX_HEADING.test(line) ||
    LIST_ITEM.test(line) ||
    THEMATIC_BREAK.test(line) ||
    /^\s*(?:>|\||<|!\[)/.test(line) ||
    /^\s*\[[^\]]+\]:/.test(line)
  ) return false;
  return true;
}

/**
 * 标题/列表节点过少时，从普通文本中补出一个只用于脑图的隐式大纲。
 * 优先识别编号章节、独立加粗行和短标签；完全没有结构信号时退化为逐自然行节点，
 * 确保非标准 MD 也不会只剩一个中心节点。代码块、frontmatter、表格和引用不参与推断。
 */
function augmentSparseOutline(root: MindNode, lines: string[]): void {
  const explicit = collectOutlineNodes(root);
  if (explicit.length > 2) return;

  const occupied = new Set(explicit.map((node) => node.lineIndex));
  const protectedLines = new Set<number>();
  let inFence = false;
  let fenceMarker = '';
  let fenceLen = 0;
  let frontmatterEnd = -1;
  if (FRONTMATTER_DELIM.test(lines[0] ?? '')) {
    for (let i = 1; i < lines.length; i++) {
      if (FRONTMATTER_DELIM.test(lines[i])) {
        frontmatterEnd = i;
        break;
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    if (i <= frontmatterEnd) {
      protectedLines.add(i);
      continue;
    }
    const fence = lines[i].match(FENCE_OPEN);
    if (fence) {
      protectedLines.add(i);
      const marker = fence[2][0];
      const len = fence[2].length;
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
        fenceLen = len;
      } else if (marker === fenceMarker && len >= fenceLen && fence[3].trim() === '') {
        inFence = false;
      }
      continue;
    }
    if (inFence) protectedLines.add(i);
  }

  const leadingH1 = explicit.some(
    (node) => node.kind === 'heading' && node.level === 1 && onlyPrefaceBefore(lines, node.lineIndex),
  );
  const baseLevel = leadingH1 ? 1 : 0;
  const structural: InferredLine[] = [];
  const prose: InferredLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (occupied.has(i) || protectedLines.has(i) || !inferableProseLine(lines[i])) continue;
    const text = cleanInferredText(lines[i]);
    if (!text) continue;
    const rank = inferredRank(lines[i]);
    const candidate = {
      lineIndex: i,
      level: Math.min(6, baseLevel + (rank ?? 1)),
      text,
    };
    prose.push(candidate);
    if (rank !== null) structural.push(candidate);
  }

  const inferred = structural.length >= 2 ? structural : explicit.length <= 1 ? prose : [];
  if (inferred.length === 0) return;

  const all = [
    ...explicit,
    ...inferred.map(({ lineIndex, level, text }) => ({
      ...makeNode('heading', level, text, lineIndex),
      inferred: true,
    })),
  ].sort((a, b) => a.lineIndex - b.lineIndex);

  root.children = [];
  const stack: MindNode[] = [root];
  for (const node of all) {
    while (stack.length > 1 && stack[stack.length - 1].level >= node.level) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
}

/** 抽取行内 wiki 链接 [[...]]，区分本文件锚点（关联线）与他文件引用。 */
function extractWiki(text: string, node: Pick<MindNode, 'refs' | 'links'>): void {
  const WIKI = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = WIKI.exec(text)) !== null) {
    const inner = m[1].trim();
    if (inner.startsWith('#')) {
      // [[#anchor]] 或 [[#path/anchor]] —— 本文件内关联线
      node.links.push(inner.slice(1).trim());
      continue;
    }
    const hashIdx = inner.indexOf('#');
    if (hashIdx >= 0) {
      node.refs.push({ target: inner.slice(0, hashIdx).trim(), anchor: inner.slice(hashIdx + 1).trim() });
    } else {
      node.refs.push({ target: inner });
    }
  }
}

/** 抽取行内标签 #xxx：词表内→类型，词表外→自由标签。 */
function extractTags(text: string, node: Pick<MindNode, 'types' | 'tags'>): void {
  const TAG = /(?:^|\s)#([^\s#]+)/g;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(text)) !== null) {
    const tag = m[1];
    if ((TYPE_VOCAB as string[]).includes(tag) && !node.types.includes(tag as NodeType)) {
      node.types.push(tag as NodeType);
    } else if (!node.tags.includes(tag)) {
      node.tags.push(tag);
    }
  }
}

/** 识别质证三性行（如「真实性：认可」），命中词表才记录 verdict。 */
function extractEvidence(text: string): EvidenceStatus | undefined {
  const status: EvidenceStatus = {};
  let anySet = false;
  for (const aspect of EVIDENCE_ASPECTS) {
    const re = new RegExp(`${aspect}\\s*[:：]\\s*(.+)$`);
    const m = text.match(re);
    if (!m) continue;
    const value = m[1].trim();
    const verdict = EVIDENCE_VERDICTS.find((v) => value === v || value.startsWith(v));
    if (verdict) {
      status[aspect] = verdict;
      anySet = true;
    }
  }
  // 仅当至少一项命中词表才返回，避免留空 evidence 对象。
  return anySet ? status : undefined;
}

/**
 * @param md 原始 Markdown 字符串
 * @param fileName 虚拟根显示名（无 H1 或多 H1 时用），可选
 */
export function parseMarkdown(md: string, fileName = ''): MindMapDoc {
  const lines = md.split('\n');

  const syntheticRoot = makeNode('root', 0, fileName, -1);
  const stack: MindNode[] = [syntheticRoot];

  let inFence = false;
  let fenceMarker = '';
  let fenceLen = 0;
  /** 当前列表段的基准缩进（首项缩进）。null=不在列表段。 */
  let listBaseIndent: number | null = null;
  /** 每个打开的列表层级的内容起始列（与栈中 list 节点一一对应，Codex R5-P0-2）。
   *  单一全局内容列会把父层松散续接（缩进只够父层）误判成跳出整段列表。 */
  let listCols: number[] = [];
  /** 当前列表项是否仍「敞开」可接收 lazy 续行：自上个列表项起未遇空行即为 true。
   *  CommonMark：未缩进的段落行若无空行分隔，是上一列表项的 lazy 续行，不打断列表。 */
  let listItemOpen = false;
  let afterFrontmatter = false;

  /** 跳出列表段：弹出栈中残留的列表节点并清基准缩进。
   *  只清 listBaseIndent 不弹栈会让后续更深标题挂到旧列表项下（Codex R4-P0-1）。 */
  const breakList = (): void => {
    while (stack.length > 1 && stack[stack.length - 1].kind === 'list') stack.pop();
    listBaseIndent = null;
    listCols = [];
    listItemOpen = false;
  };

  /** 空行后遇到缩进为 indent 的非列表内容行：只弹出比该缩进更深的列表层级
   *  （Codex R5-P0-2）。返回是否仍留在列表段内（松散续接）。 */
  const popListDeeperThan = (indent: number): boolean => {
    // 栈中 list 节点与 listCols 一一对应（同级项入栈前先弹出同级，故每层只留一个）。
    while (listCols.length > 0 && indent < listCols[listCols.length - 1]) {
      listCols.pop();
      if (stack.length > 1 && stack[stack.length - 1].kind === 'list') stack.pop();
    }
    if (listCols.length === 0) {
      breakList();
      return false;
    }
    return true;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // YAML frontmatter：开头 --- ... --- 整段跳过（不识别为大纲/HR）。
    if (!afterFrontmatter && !inFence && i === 0 && FRONTMATTER_DELIM.test(line)) {
      // 寻找闭合 ---
      let j = i + 1;
      while (j < lines.length && !FRONTMATTER_DELIM.test(lines[j])) j++;
      if (j < lines.length) {
        i = j; // 跳到闭合行；下一轮 i+1 继续
        afterFrontmatter = true;
        listBaseIndent = null;
        continue;
      }
      // 没有闭合，按普通行处理
      afterFrontmatter = true;
    }

    // 代码围栏开关
    const fenceMatch = line.match(FENCE_OPEN);
    if (fenceMatch) {
      const marker = fenceMatch[2][0];
      const len = fenceMatch[2].length;
      const rest = fenceMatch[3];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
        fenceLen = len;
        // 缩进达到所在列表层级内容列的围栏是列表项内容，不打断该层（Codex R4-P0-2）；
        // 只弹出比围栏缩进更深的层级，顶格围栏才跳出整段。围栏非段落，关闭 lazy 窗口。
        if (listBaseIndent !== null) {
          popListDeeperThan(expandCols(fenceMatch[1]));
        }
        listItemOpen = false;
      } else if (marker === fenceMarker && len >= fenceLen && rest.trim() === '') {
        // CommonMark：闭合围栏须同字符、长度 ≥ 开启长度、且后缀仅空白
        //（```text 带 info string 是开围栏，不能闭合当前围栏）。
        inFence = false;
      }
      // 其余（围栏内 content 行、或围栏内出现的带 info 开围栏）不打断列表、不产节点。
      continue;
    }
    if (inFence) {
      // 围栏内一切原样保留，不解析。
      continue;
    }

    // 空行：不产生节点，但关闭当前列表项的 lazy 续行窗口
    // （其后的未缩进段落才视为跳出列表）。
    if (line.trim() === '') {
      listItemOpen = false;
      continue;
    }

    // ATX 标题
    const h = line.match(ATX_HEADING);
    if (h) {
      const level = h[1].length;
      const text = h[2].replace(/\s+#+\s*$/, '').trim();
      // ATX 标题必然顶格（正则不允许前导空白），一律跳出列表段：
      // 否则 lazy 续行后的顶格标题会挂到列表项下（Codex R5-P0-1）。
      breakList();
      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
      const parent = stack[stack.length - 1];
      const node = makeNode('heading', level, text, i);
      parent.children.push(node);
      stack.push(node);
      continue;
    }

    // 主题分隔线（--- / *** / ___ 三连+，可含空格）：非大纲。
    // 缩进达到所在列表层级内容列的分隔线是列表项内容，与围栏同判（Codex R5-P0-3）；
    // 只弹出比其缩进更深的层级，顶格分隔线才跳出整段。关闭 lazy 窗口。
    const tb = line.match(THEMATIC_BREAK);
    if (tb) {
      if (listBaseIndent !== null) {
        popListDeeperThan(expandCols(tb[1]));
      }
      listItemOpen = false;
      continue;
    }

    // 列表项
    const l = line.match(LIST_ITEM);
    if (l) {
      const indent = expandCols(l[1]); // 缩进按列宽算（tab → 4 列停靠位，Codex R4-P0-3）
      const text = l[4].trim();
      if (listBaseIndent === null || indent < listBaseIndent) {
        // 新列表段（首项 / 段落打断后重启 / 缩进回退到 base 以下）：
        // 先把栈回退到最近的非列表祖先（标题/根），否则新列表会挂在旧列表项下。
        while (stack.length > 1 && stack[stack.length - 1].kind === 'list') {
          if (listCols.length > 0) listCols.pop();
          stack.pop();
        }
        listBaseIndent = indent;
        listCols = [];
      }
      // 弹栈直到栈顶 list 项的 contentCol <= indent（确定逻辑父节点，Codex R6-P0-1）：
      // 缩进不足以嵌到最近父项内容列时（如 `1. a / - child(2)` 因 a 内容列=3 > 2），
      // 退到更浅的父节点，而非按固定 2-space 步长强行当嵌套。
      while (
        stack.length > 1 &&
        stack[stack.length - 1].kind === 'list' &&
        listCols.length > 0 &&
        indent < listCols[listCols.length - 1]
      ) {
        listCols.pop();
        stack.pop();
      }
      // 列表项的 depth = 父节点 level + 1；父节点由上面弹栈后的栈顶确定。
      const parent = stack[stack.length - 1];
      const depth = parent.level + 1;
      const node = makeNode('list', depth, text, i);
      parent.children.push(node);
      stack.push(node);
      // CommonMark 内容列规则（Codex R7-P2 / R8-P1）：
      // - marker 后 1–4 列 padding：内容列 = marker 结束列 + 实际 padding 列数
      //   （padding 全算列表项 padding，下一列才是内容）。
      // - marker 后 ≥ 5 列 padding：内容列 = marker 结束列 + 1（第 5 列起是缩进代码块
      //   内容，但**列表项本身**的内容列固定为 marker 后那一列）。
      // 修复前曾把全部 case 统一为 markerCol+1（R7）——对 padding 1–4 列的合法
      // Markdown 会过窄估内容列，把该平级的子项误挂成父项子节点。
      const markerCol = indent + l[2].length;
      const padEndCol = expandCols(l[3], markerCol);
      const padLen = padEndCol - markerCol;
      const contentCol = padLen <= 4 ? padEndCol : markerCol + 1;
      listCols.push(contentCol);
      listItemOpen = true;
      continue;
    }

    // 非大纲有内容行：判定是否打断当前列表。
    // (a) 列表项仍敞开（未遇空行）：任意段落行都是 lazy 续行，不打断列表
    //     —— 含未缩进行（CommonMark 视为上一项段落续行）。
    // (b) 空行后：缩进代码块（≥ 最深列表内容列 + 4 列，Codex R6-P0-2）不是段落续接，
    //     不重开 lazy 窗口；否则只弹出比该行缩进更深的列表层级（Codex R5-P0-2），
    //     缩进够到某层内容列 = 该层松散续接，重新敞开 lazy 窗口；全部不够 = 跳出列表段。
    if (line.trim() !== '' && listBaseIndent !== null && !listItemOpen) {
      const lineIndent = expandCols(line.match(/^(\s*)/)?.[1] ?? '');
      // 缩进代码块判定：行缩进减去最深列表项内容列 ≥ 4 列。
      // 列表项下的代码块需至少「内容列 + 4」缩进（CommonMark 规则），不能与段落 lazy 续接混为一谈。
      const deepestCol = listCols.length > 0 ? listCols[listCols.length - 1] : -1;
      const isIndentedCodeBlock =
        listCols.length > 0 && lineIndent - deepestCol >= INDENT_INDENT;
      if (!isIndentedCodeBlock && popListDeeperThan(lineIndent)) {
        listItemOpen = true;
      }
    }
  }

  augmentSparseOutline(syntheticRoot, lines);
  assignNodeBodiesAndParagraphs(syntheticRoot, lines);

  // 目录章节（目录/TOC/Contents）不入图：脑图本身就是目录。
  // 序列化按行区间回填，被排除节的原文行归入前驱节点区间，往返无损。
  removeTocSections(syntheticRoot, lines);

  // 首标题为 H1 且其前只有空行/frontmatter 时提升为根（文档大标题即中心节点），
  // 其余 H1 作为一级分支挂到根下——先序仍与文档顺序一致，序列化不受影响。
  let root = syntheticRoot;
  const first = syntheticRoot.children[0];
  if (
    first &&
    first.kind === 'heading' &&
    !first.inferred &&
    first.level === 1 &&
    onlyPrefaceBefore(lines, first.lineIndex)
  ) {
    root = first;
    root.children.push(...syntheticRoot.children.slice(1));
  }

  // 抽取领域字段 + 生成 id（内容路径）
  assignFieldsAndIds(root);

  return { root, lines };
}

/**
 * 把每个节点紧随其后的非大纲原文完整投影到节点正文。
 * 空行只用于保留段落分隔；首尾空行去掉，正文中的 Markdown 标记不改写。
 */
interface BodyParagraph {
  lineIndex: number;
  endLineIndex: number;
  markdown: string;
}

/**
 * 按 CommonMark 的段落边界切分正文：空行结束一个块，连续非空物理行仍属于同一段。
 * 代码围栏、表格、主题分隔线和 HTML 块继续留在右侧完整正文中，不膨胀脑图。
 */
function splitBodyParagraphs(bodyLines: string[], startLineIndex: number): BodyParagraph[] {
  const paragraphs: BodyParagraph[] = [];
  let blockStart = -1;
  let blockEnd = -1;
  let blockLines: string[] = [];
  let inFence = false;
  let fenceMarker = '';
  let fenceLen = 0;

  const flush = (): void => {
    if (blockStart < 0 || blockLines.length === 0) return;
    const markdown = blockLines.join('\n').trim();
    const first = blockLines[0] ?? '';
    const isVisualParagraph = markdown
      && !FENCE_OPEN.test(first)
      && !THEMATIC_BREAK.test(first)
      && !/^\s*(?:\||<|!\[)/.test(first);
    if (isVisualParagraph) {
      paragraphs.push({ lineIndex: blockStart, endLineIndex: blockEnd, markdown });
    }
    blockStart = -1;
    blockEnd = -1;
    blockLines = [];
  };

  for (let offset = 0; offset < bodyLines.length; offset++) {
    const line = bodyLines[offset];
    const fence = line.match(FENCE_OPEN);
    if (fence) {
      const marker = fence[2][0];
      const len = fence[2].length;
      if (!inFence) {
        flush();
        inFence = true;
        fenceMarker = marker;
        fenceLen = len;
      } else if (marker === fenceMarker && len >= fenceLen && fence[3].trim() === '') {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;
    if (line.trim() === '') {
      flush();
      continue;
    }
    if (blockStart < 0) blockStart = startLineIndex + offset;
    blockLines.push(line);
    blockEnd = startLineIndex + offset + 1;
  }
  flush();
  return paragraphs;
}

function makeParagraphNode(parent: MindNode, paragraph: BodyParagraph): MindNode {
  const node = makeNode('paragraph', Math.min(7, parent.level + 1), paragraph.markdown, paragraph.lineIndex);
  node.body = paragraph.markdown;
  node.projected = true;
  node.sourceEndLineIndex = paragraph.endLineIndex;
  return node;
}

/**
 * 诉讼文书末尾常以“综上……”收束，再依次出现“此致”、法院、署名和日期。
 * 仅在确实存在独立“此致”时截断脑图投影，避免把结语和落款误当成最后一个论点的正文节点。
 * node.body 仍保留完整区间，右侧阅读与 Markdown 原文不受影响。
 */
function projectionBodyLines(bodyLines: string[]): string[] {
  const salutationIndex = bodyLines.findIndex((line) => /^\s*此致\s*[，,。]?$/.test(line));
  if (salutationIndex < 0) return bodyLines;

  for (let index = salutationIndex - 1; index >= 0; index--) {
    const text = bodyLines[index].trim();
    if (!text) continue;
    if (/^综上(?:所述)?[，,]/.test(text)) return bodyLines.slice(0, index);
    break;
  }
  return bodyLines.slice(0, salutationIndex);
}

function assignNodeBodiesAndParagraphs(root: MindNode, lines: string[]): void {
  const nodes = collectOutlineNodes(root).sort((a, b) => a.lineIndex - b.lineIndex);
  const boundaries = nodes.map((node) => node.lineIndex);

  if (root.kind === 'root') {
    let start = 0;
    if (FRONTMATTER_DELIM.test(lines[0] ?? '')) {
      const end = lines.findIndex((line, index) => index > 0 && FRONTMATTER_DELIM.test(line));
      if (end >= 0) start = end + 1;
    }
    const prefixLines = lines.slice(start, boundaries[0] ?? lines.length);
    while (prefixLines.length > 0 && prefixLines[0].trim() === '') prefixLines.shift();
    while (prefixLines.length > 0 && prefixLines[prefixLines.length - 1].trim() === '') prefixLines.pop();
    root.body = prefixLines.join('\n');
  }

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const end = boundaries[i + 1] ?? lines.length;
    const bodyStart = node.lineIndex + 1;
    const rawBodyLines = lines.slice(bodyStart, end);
    const bodyLines = [...rawBodyLines];
    while (bodyLines.length > 0 && bodyLines[0].trim() === '') bodyLines.shift();
    while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === '') bodyLines.pop();
    node.body = bodyLines.join('\n');
    if (!node.body) continue;
    node.projections = splitBodyParagraphs(projectionBodyLines(rawBodyLines), bodyStart)
      .map((paragraph) => makeParagraphNode(node, paragraph));
  }
}

const TOC_HEADING_TITLES = new Set(['目录', 'toc', 'contents', 'table of contents']);

/**
 * 从树中移除「目录/TOC/Contents」章节。
 *
 * 一些生成器会输出 `# 目录`，再用主题分隔线结束目录，正文却从 `##` 继续。
 * 单看标题层级，正文会被误挂为目录子树；删除目录时必须把分隔线后的节点提升回父级。
 */
function removeTocSections(node: MindNode, lines: string[]): void {
  const kept: MindNode[] = [];
  for (const child of node.children) {
    if (child.kind === 'heading' && TOC_HEADING_TITLES.has(child.text.trim().toLowerCase())) {
      const dividerLine = lines.findIndex(
        (line, index) => index > child.lineIndex && THEMATIC_BREAK.test(line),
      );
      if (dividerLine >= 0) {
        const promoted = child.children.filter((descendant) => descendant.lineIndex > dividerLine);
        for (const descendant of promoted) removeTocSections(descendant, lines);
        kept.push(...promoted);
      }
      continue;
    }
    removeTocSections(child, lines);
    kept.push(child);
  }
  node.children = kept;
}

/** lineIndex 之前是否只有空行与 frontmatter，即该标题位于文档开头（是文档大标题）。 */
function onlyPrefaceBefore(lines: string[], lineIndex: number): boolean {
  let i = 0;
  if (lineIndex > 0 && FRONTMATTER_DELIM.test(lines[0])) {
    let j = 1;
    while (j < lineIndex && !FRONTMATTER_DELIM.test(lines[j])) j++;
    if (j < lineIndex) i = j + 1;
  }
  for (; i < lineIndex; i++) {
    if (lines[i].trim() !== '') return false;
  }
  return true;
}

function assignFieldsAndIds(root: MindNode): void {
  const walk = (node: MindNode, idPath: string, siblings: MindNode[]): void => {
    const sameName = siblings.filter((sibling) => sibling.kind === node.kind && sibling.text === node.text);
    const occurrence = sameName.indexOf(node) + 1;
    const segment = node.kind === 'root'
      ? ''
      : node.projected
        ? `paragraph:line-${node.lineIndex}`
        : `${node.kind}:${node.text}${sameName.length > 1 ? `#${occurrence}` : ''}`;
    node.id = idPath ? `${idPath}/${segment}` : segment;
    extractTags(node.text, node);
    extractWiki(node.text, node);
    const ev = extractEvidence(node.text);
    if (ev) node.evidence = ev;
    for (const projection of node.projections) walk(projection, node.id, node.projections);
    for (const child of node.children) walk(child, node.id, node.children);
  };
  walk(root, '', [root]);
}

/** 统计文档中所有真实节点（先序 DFS，跳过虚拟根），用于序列化与渲染。 */
export function collectOutlineNodes(root: MindNode): MindNode[] {
  const out: MindNode[] = [];
  const walk = (node: MindNode): void => {
    if (node.kind === 'heading' || node.kind === 'list') out.push(node);
    for (const child of node.children) walk(child);
  };
  walk(root);
  return out;
}

/** 脑图渲染/阅读所需的全部节点，包括可原位编辑的正文段落投影。 */
export function collectMindMapNodes(root: MindNode): MindNode[] {
  const out: MindNode[] = [];
  const walk = (node: MindNode): void => {
    if (node.kind !== 'root') out.push(node);
    for (const projection of node.projections) walk(projection);
    for (const child of node.children) walk(child);
  };
  walk(root);
  return out;
}
