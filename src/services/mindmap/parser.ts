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
/** 无序与有序列表项；有序只取序号占位，深度按缩进算。 */
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})/;
const FRONTMATTER_DELIM = /^---\s*$/;

const TYPE_VOCAB: NodeType[] = ['要件', '争点', '证据', '法条', '事实', '质证'];
const EVIDENCE_VERDICTS: EvidenceVerdict[] = ['认可', '不认可', '部分认可'];
const EVIDENCE_ASPECTS = ['真实性', '合法性', '关联性'] as const;

/** 列表每级缩进步长（标准 2 空格）。4 空格算两级，对真实笔记足够稳健。 */
const INDENT_STEP = 2;

function makeNode(kind: MindNode['kind'], level: number, text: string, lineIndex: number): MindNode {
  return {
    id: '',
    kind,
    level,
    text,
    children: [],
    types: [],
    tags: [],
    refs: [],
    links: [],
    lineIndex,
  };
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
  let hit = false;
  for (const aspect of EVIDENCE_ASPECTS) {
    const re = new RegExp(`${aspect}\\s*[:：]\\s*(.+)$`);
    const m = text.match(re);
    if (!m) continue;
    hit = true;
    const value = m[1].trim();
    const verdict = EVIDENCE_VERDICTS.find((v) => value === v || value.startsWith(v));
    if (verdict) status[aspect] = verdict;
  }
  return hit ? status : undefined;
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
  /** 当前列表连续段的基准缩进；遇到段落等非大纲非空行重置，空行保留。 */
  let listBaseIndent: number | null = null;
  let listBaseDepth = 0;
  let afterFrontmatter = false;

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
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
      }
      // 围栏行本身是非大纲行，落入所在节点区间，不产生节点。
      listBaseIndent = null;
      continue;
    }
    if (inFence) {
      // 围栏内一切原样保留，不解析。
      continue;
    }

    // ATX 标题
    const h = line.match(ATX_HEADING);
    if (h) {
      const level = h[1].length;
      const text = h[2].replace(/\s+#+\s*$/, '').trim();
      listBaseIndent = null;
      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
      const parent = stack[stack.length - 1];
      const node = makeNode('heading', level, text, i);
      parent.children.push(node);
      stack.push(node);
      continue;
    }

    // 列表项
    const l = line.match(LIST_ITEM);
    if (l) {
      const indent = l[1].length;
      const text = l[2].trim();
      if (listBaseIndent === null || indent < listBaseIndent) {
        // 新列表段：基准深度 = 当前栈顶（最近上级大纲节点）深度 + 1
        listBaseIndent = indent;
        listBaseDepth = stack[stack.length - 1].level + 1;
      }
      const nest = Math.floor((indent - listBaseIndent) / INDENT_STEP);
      const depth = listBaseDepth + nest;
      while (stack.length > 1 && stack[stack.length - 1].level >= depth) stack.pop();
      const parent = stack[stack.length - 1];
      const node = makeNode('list', depth, text, i);
      parent.children.push(node);
      stack.push(node);
      continue;
    }

    // 非大纲行：空行不重置列表基准（允许列表项间空行）；有内容的段落等则重置。
    if (line.trim() !== '') {
      listBaseIndent = null;
    }
  }

  // 抽取领域字段 + 生成 id（内容路径）
  assignFieldsAndIds(syntheticRoot);

  // 单个 H1 提升为根（匹配方案 3.1）；否则保留虚拟根。
  let root = syntheticRoot;
  if (
    syntheticRoot.children.length === 1 &&
    syntheticRoot.children[0].kind === 'heading' &&
    syntheticRoot.children[0].level === 1
  ) {
    root = syntheticRoot.children[0];
  }

  return { root, lines };
}

function assignFieldsAndIds(root: MindNode): void {
  const walk = (node: MindNode, idPath: string): void => {
    const segment = node.kind === 'root' ? '' : node.text;
    node.id = idPath ? `${idPath}/${segment}` : segment;
    extractTags(node.text, node);
    extractWiki(node.text, node);
    const ev = extractEvidence(node.text);
    if (ev) node.evidence = ev;
    for (const child of node.children) walk(child, node.id);
  };
  walk(root, '');
}

/** 统计文档中所有真实节点（先序 DFS，跳过虚拟根），用于序列化与渲染。 */
export function collectOutlineNodes(root: MindNode): MindNode[] {
  const out: MindNode[] = [];
  const walk = (node: MindNode): void => {
    if (node.kind !== 'root') out.push(node);
    for (const child of node.children) walk(child);
  };
  walk(root);
  return out;
}
