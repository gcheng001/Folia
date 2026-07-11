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
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})(.*)$/;
const FRONTMATTER_DELIM = /^---\s*$/;
/** 主题分隔线：3+ 同字符（- * _）以空格分隔，整行匹配。 */
const THEMATIC_BREAK = /^(\s*)([-*_])(?:\s*\2){2,}\s*$/;

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
  /** 当前列表段的内容起始列（基准缩进 + marker + 至少1空格）；段落缩进≥此列=续接。 */
  let listContentCol = 0;
  let listBaseDepth = 0;
  /** 当前列表项是否仍「敞开」可接收 lazy 续行：自上个列表项起未遇空行即为 true。
   *  CommonMark：未缩进的段落行若无空行分隔，是上一列表项的 lazy 续行，不打断列表。 */
  let listItemOpen = false;
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
      const len = fenceMatch[2].length;
      const rest = fenceMatch[3];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
        fenceLen = len;
        listBaseIndent = null; // 开启围栏打断列表
      } else if (marker === fenceMarker && len >= fenceLen && rest.trim() === '') {
        // CommonMark：闭合围栏须同字符、长度 ≥ 开启长度、且后缀仅空白
        //（```text 带 info string 是开围栏，不能闭合当前围栏）。
        inFence = false;
        listBaseIndent = null;
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
      listBaseIndent = null;
      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
      const parent = stack[stack.length - 1];
      const node = makeNode('heading', level, text, i);
      parent.children.push(node);
      stack.push(node);
      continue;
    }

    // 主题分隔线（--- / *** / ___ 三连+，可含空格）：非大纲，按段落打断列表段
    if (THEMATIC_BREAK.test(line)) {
      listBaseIndent = null;
      continue;
    }

    // 列表项
    const l = line.match(LIST_ITEM);
    if (l) {
      const indent = l[1].length;
      const markerLen = l[2].length;
      const text = l[3].trim();
      if (listBaseIndent === null || indent < listBaseIndent) {
        // 新列表段（首项 / 段落打断后重启 / 缩进回退到 base 以下）：
        // 先把栈回退到最近的非列表祖先（标题/根），否则新列表会挂在旧列表项下。
        while (stack.length > 1 && stack[stack.length - 1].kind === 'list') stack.pop();
        listBaseIndent = indent;
        listContentCol = indent + markerLen + 1; // marker + 至少 1 空格 = 内容起始列
        listBaseDepth = stack[stack.length - 1].level + 1;
      }
      const nest = Math.floor((indent - listBaseIndent) / INDENT_STEP);
      const depth = listBaseDepth + nest;
      while (stack.length > 1 && stack[stack.length - 1].level >= depth) stack.pop();
      const parent = stack[stack.length - 1];
      const node = makeNode('list', depth, text, i);
      parent.children.push(node);
      stack.push(node);
      listItemOpen = true;
      continue;
    }

    // 非大纲有内容行：判定是否打断当前列表。
    // (a) 列表项仍敞开（未遇空行）：任意段落行都是 lazy 续行，不打断列表
    //     —— 含未缩进行（CommonMark 视为上一项段落续行）。
    // (b) 空行后：缩进 ≥ 内容列 = 松散列表续接，列表保持；缩进 < 内容列 = 跳出列表。
    if (line.trim() !== '' && listBaseIndent !== null && !listItemOpen) {
      const lineIndent = line.match(/^(\s*)/)?.[1].length ?? 0;
      if (lineIndent < listContentCol) listBaseIndent = null;
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
