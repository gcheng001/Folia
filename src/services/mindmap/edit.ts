/**
 * 脑图编辑内核（M-C，PRD 项 C）。
 *
 * 设计：不直接改树再序列化，而是**行级手术 + 重解析**——
 * 每个操作利用节点的 lineIndex 在 `doc.lines` 副本上做最小行变更，
 * 返回新 Markdown；画布拿新 MD 重新 parse → layout → 渲染。
 * 非大纲行（正文/法条/表格/代码块）只随所属节点的行区间整体移动，
 * 永不被改写，保证 MD 唯一源与往返无损。
 *
 * 所有操作对非法目标（根节点删除/升级等）返回 null，由调用方忽略。
 */
import type { MindMapDoc, MindNode } from './types';
import { collectOutlineNodes, expandCols, parseMarkdown } from './parser';

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/;

export interface EditResult {
  markdown: string;
  /** 新建 outline 行在新文档中的下标（即新节点的画布 id 来源） */
  newLineIndex: number;
}

interface Located {
  node: MindNode;
  parent: MindNode | null;
}

function locate(root: MindNode, lineIndex: number): Located | null {
  if (root.lineIndex === lineIndex) return { node: root, parent: null };
  const walk = (parent: MindNode): Located | null => {
    for (const child of parent.children) {
      if (child.lineIndex === lineIndex) return { node: child, parent };
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(root);
}

function descendantSet(node: MindNode): Set<MindNode> {
  const set = new Set<MindNode>();
  const walk = (n: MindNode): void => {
    for (const c of n.children) {
      set.add(c);
      walk(c);
    }
  };
  walk(node);
  return set;
}

/** 节点子树的行区间终点（开区间）：先序中第一个非后代节点的 outline 行；无则文档末尾。 */
function subtreeEnd(doc: MindMapDoc, node: MindNode): number {
  if (node === doc.root) return doc.lines.length;
  const ordered = collectOutlineNodes(doc.root);
  const desc = descendantSet(node);
  const k = ordered.indexOf(node);
  if (k < 0) return doc.lines.length;
  for (let i = k + 1; i < ordered.length; i++) {
    if (!desc.has(ordered[i])) return ordered[i].lineIndex;
  }
  return doc.lines.length;
}

function isBlank(line: string | undefined): boolean {
  return line === undefined || line.trim() === '';
}

/** 在 at 处插入行块。pad=true（标题）时按需补前后空行分隔；列表不补（空行会打断列表段）。 */
function insertLines(
  lines: string[],
  at: number,
  block: string[],
  pad: boolean,
): { out: string[]; newLineIndex: number } {
  const chunk = [...block];
  let newLineIndex = at;
  if (pad) {
    if (at > 0 && !isBlank(lines[at - 1])) {
      chunk.unshift('');
      newLineIndex = at + 1;
    }
    if (at < lines.length && !isBlank(lines[at])) {
      chunk.push('');
    }
  }
  return { out: [...lines.slice(0, at), ...chunk, ...lines.slice(at)], newLineIndex };
}

/** 移除行区间 [start, end)，并把接缝处的连续空行合并为一个。 */
function removeLines(lines: string[], start: number, end: number): string[] {
  const out = [...lines.slice(0, start), ...lines.slice(end)];
  if (start > 0 && start < out.length && isBlank(out[start - 1]) && isBlank(out[start])) {
    out.splice(start, 1);
  }
  while (out.length >= 2 && out[out.length - 1] === '' && out[out.length - 2] === '') {
    out.pop();
  }
  return out;
}

function headingLine(level: number, text: string): string {
  return `${'#'.repeat(level)} ${text}`;
}

/** 列表项的空同级行：沿用参照行的缩进与 marker。 */
function listSiblingLine(refLine: string): string | null {
  const m = refLine.match(LIST_ITEM);
  if (!m) return null;
  return `${m[1]}${m[2]} `;
}

/** 列表项的空子行：缩进到父项内容列。列宽计算与解析器同一规则
 *  （tab 按 4 列停靠位展开；padding 1–4 列按实际列数、≥5 列按 marker 末列 +1，Codex R3-P1）。 */
function listChildLine(parentLine: string): string | null {
  const m = parentLine.match(LIST_ITEM);
  if (!m) return null;
  const markerCol = expandCols(m[1]) + m[2].length;
  const padEndCol = expandCols(m[3], markerCol);
  const padLen = padEndCol - markerCol;
  const contentCol = padLen <= 4 ? padEndCol : markerCol + 1;
  return `${' '.repeat(contentCol)}- `;
}

function documentTitleInsertIndex(lines: string[]): number {
  if (!/^---\s*$/.test(lines[0] ?? '')) return 0;
  for (let i = 1; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) return i + 1;
  }
  return 0;
}

/**
 * 改节点文字：真实节点只重写该 outline 行，保留层级/缩进/marker；
 * 文件名虚拟根首次编辑时在 frontmatter 后插入 H1，使修改成为 Markdown 的真实内容。
 */
export function editNodeText(doc: MindMapDoc, lineIndex: number, newText: string): string | null {
  const hit = locate(doc.root, lineIndex);
  if (!hit) return null;
  const lines = [...doc.lines];
  if (hit.node.kind === 'root') {
    if (newText.trim() === '') return null;
    const { out } = insertLines(lines, documentTitleInsertIndex(lines), [headingLine(1, newText)], true);
    return out.join('\n');
  }
  if (hit.node.kind === 'heading') {
    lines[lineIndex] = headingLine(hit.node.level, newText);
  } else {
    const m = lines[lineIndex].match(LIST_ITEM);
    if (!m) return null;
    lines[lineIndex] = `${m[1]}${m[2]}${m[3]}${newText}`;
  }
  return lines.join('\n');
}

/** Enter：在节点子树末尾之后插入同级空节点。根节点不允许。 */
export function insertSibling(doc: MindMapDoc, lineIndex: number): EditResult | null {
  const hit = locate(doc.root, lineIndex);
  if (!hit || hit.node === doc.root) return null;
  const { node } = hit;
  const at = subtreeEnd(doc, node);

  let newLine: string;
  let pad: boolean;
  if (node.kind === 'heading') {
    newLine = headingLine(node.level, '');
    pad = true;
  } else {
    const line = listSiblingLine(doc.lines[node.lineIndex]);
    if (!line) return null;
    newLine = line;
    pad = false;
  }
  const { out, newLineIndex } = insertLines(doc.lines, at, [newLine], pad);
  return { markdown: out.join('\n'), newLineIndex };
}

/** Tab：作为末位子节点插入空节点。根（含虚拟根）允许——即追加顶层节点。 */
export function insertChild(doc: MindMapDoc, lineIndex: number): EditResult | null {
  const hit = locate(doc.root, lineIndex);
  if (!hit) return null;
  const { node } = hit;
  const at = subtreeEnd(doc, node);

  let newLine: string;
  let pad: boolean;
  if (node.kind === 'list') {
    const line = listChildLine(doc.lines[node.lineIndex]);
    if (!line) return null;
    newLine = line;
    pad = false;
  } else {
    // H6 无更深标题层级，"七级子节点"重解析会变成兄弟——直接不允许（Codex R3-P2）
    if (node.kind === 'heading' && node.level >= 6) return null;
    const childLevel = node.kind === 'root' ? 1 : node.level + 1;
    newLine = headingLine(childLevel, '');
    pad = true;
  }
  const { out, newLineIndex } = insertLines(doc.lines, at, [newLine], pad);
  return { markdown: out.join('\n'), newLineIndex };
}

/** Delete：删除节点整子树（含其行区间内的正文）。根节点不允许。 */
export function deleteNode(doc: MindMapDoc, lineIndex: number): string | null {
  const hit = locate(doc.root, lineIndex);
  if (!hit || hit.node === doc.root) return null;
  const end = subtreeEnd(doc, hit.node);
  return removeLines(doc.lines, lineIndex, end).join('\n');
}

/**
 * 把 source 整棵子树作为 target 的最后一个子节点挂上去。
 *
 * 合法性（与设计文档一致）：
 *  - source 不能是根节点。
 *  - source 不能是自己或自己的后代（避免形成环）。
 *  - source 与 target 必须同种（heading↔heading / list↔list），跨种拖放
 *    由 UI 层在 400ms 高亮阶段拦截，此处再以 null 兜底。
 *  - heading：source 子树里所有 heading 的 level 整体平移到 target.level+1，
 *    且必须保证平移后最深层级 ≤ 6（Markdown 合法上限）。
 *  - list：source 子树里所有列表项的缩进统一对齐到 target 项的内容列
 *    （避免挂在更浅/更深的层级而失去嵌套关系）。
 *
 * 副作用：返回值就是新 MD；调用方负责清掉 source 子树旧的手拖坐标。
 */
export function moveSubtreeAsLastChild(
  doc: MindMapDoc,
  sourceLineIndex: number,
  targetLineIndex: number,
): string | null {
  if (sourceLineIndex === targetLineIndex) return null;
  const sourceHit = locate(doc.root, sourceLineIndex);
  const targetHit = locate(doc.root, targetLineIndex);
  if (!sourceHit || !targetHit) return null;
  if (sourceHit.node === doc.root) return null;
  if (sourceHit.node === targetHit.node) return null;
  if (sourceHit.node.kind !== targetHit.node.kind) return null;

  const start = sourceHit.node.lineIndex;
  const end = subtreeEnd(doc, sourceHit.node);
  if (start <= targetHit.node.lineIndex && targetHit.node.lineIndex < end) return null;
  // target 自身也在 source 子树内
  if (targetHit.node.lineIndex >= start && targetHit.node.lineIndex < end) return null;

  const block = doc.lines.slice(start, end);

  if (sourceHit.node.kind === 'heading') {
    const sourceLevel = (sourceHit.node as MindNode & { level: number }).level;
    const targetLevel = (targetHit.node as MindNode & { level: number }).level;
    const delta = targetLevel + 1 - sourceLevel;
    // delta < 0 表示 source 比 target 深，结构上要降级——UI 层在 400ms 高亮阶段
    // 已经阻止「拖到自己/自己后代」，这里兜底拦截剩余情况。
    if (delta < 0) return null;
    let maxNew = targetLevel + 1;
    const rewrite = (n: MindNode): void => {
      if (n.kind === 'heading') {
        const next = n.level + delta;
        if (next > 6) return; // 标记为非法，循环结束后统一拒绝
        if (next > maxNew) maxNew = next;
        block[n.lineIndex - start] = `${'#'.repeat(next)} ${n.text}`;
      }
      for (const c of n.children) rewrite(c);
    };
    rewrite(sourceHit.node);
    if (maxNew > 6) return null;
  } else {
    // list：重写 source 及其后代每一项的缩进，使 source 真的嵌到 target 之下。
    // 与 insertChild 一致：子项内容列 = 父项内容列 + 2（markmap 约定，
    // 解析器「内容列 > 父内容列」即判为子项）。
    const refLine = doc.lines[targetHit.node.lineIndex];
    const m = refLine.match(LIST_ITEM);
    if (!m) return null;
    const markerCol = expandCols(m[1]) + m[2].length;
    const padEndCol = expandCols(m[3], markerCol);
    const padLen = padEndCol - markerCol;
    const targetContentCol = padLen <= 4 ? padEndCol : markerCol + 1;
    const desiredSourceContentCol = targetContentCol + 2;
    const reindent = (n: MindNode): void => {
      const line = block[n.lineIndex - start];
      const lm = line.match(LIST_ITEM);
      if (!lm) return;
      const oldCol = expandCols(lm[1]);
      const oldMarkerCol = oldCol + lm[2].length;
      const oldPadEndCol = expandCols(lm[3], oldMarkerCol);
      const oldPadLen = oldPadEndCol - oldMarkerCol;
      const oldContentCol = oldPadLen <= 4 ? oldPadEndCol : oldMarkerCol + 1;
      // 旧内容列基线 → 目标内容列基线 + 2，所有前导空白列整体平移
      const shift = desiredSourceContentCol - oldContentCol;
      const newWs = shiftColumns(lm[1], shift);
      block[n.lineIndex - start] = `${newWs}${lm[2]}${lm[3]}${lm[4]}`;
      for (const c of n.children) reindent(c);
    };
    reindent(sourceHit.node);
  }

  // 在 target 的子树末尾（开区间）插入：先删 source 子树，再插到 target 子树尾。
  // 删除后源树行号已失效，按「树路径」在新解析出的树里找回 target，保证多
  // 个同名节点时也能精确定位。
  const removed = removeLines(doc.lines, start, end);
  const targetPath = nodePath(doc.root, targetHit.node);
  if (!targetPath) return null;
  const reParsed = parseMarkdown(removed.join('\n'));
  const reTarget = nodeAtPath(reParsed.root, targetPath);
  if (!reTarget) return null;
  const targetEnd = subtreeEnd(reParsed, reTarget);
  const { out } = insertLines(
    removed,
    Math.min(targetEnd, removed.length),
    block,
    sourceHit.node.kind === 'heading',
  );
  return out.join('\n');
}

/** 从根到达目标节点的路径（每步是 children[] 内的下标），不包含根自身。 */
function nodePath(root: MindNode, target: MindNode): number[] | null {
  if (root === target) return [];
  const walk = (node: MindNode, path: number[]): number[] | null => {
    for (let i = 0; i < node.children.length; i++) {
      const c = node.children[i];
      if (c === target) return [...path, i];
      const sub = walk(c, [...path, i]);
      if (sub) return sub;
    }
    return null;
  };
  return walk(root, []);
}

function nodeAtPath(root: MindNode, path: number[]): MindNode | null {
  let cur: MindNode = root;
  for (const idx of path) {
    const next = cur.children[idx];
    if (!next) return null;
    cur = next;
  }
  return cur;
}

/** 把一段空白按列宽平移 shift 列（tab 视为单列占位，重新展开为等数量的空格）。 */
function shiftColumns(ws: string, shift: number): string {
  if (shift === 0) return ws;
  const cur = expandCols(ws);
  const target = Math.max(0, cur + shift);
  if (shift > 0) {
    return ws + ' '.repeat(target - cur);
  }
  // 简化：只剥掉前导空格，不支持负 shift 内部有 tab（v1 不会发生）
  return ' '.repeat(target) + ws.replace(/^[ \t]+/, '');
}

/**
 * Shift+Tab：节点升一级，成为父节点的后继同级——整子树移动到父子树末尾。
 * 标题：本节点与后代标题行层级整体平移；列表：并入父项同级（子项缩进不变，嵌套关系保持）。
 * 根节点、一级节点、直属标题的列表项不可升级。
 */
export function promoteNode(doc: MindMapDoc, lineIndex: number): string | null {
  const hit = locate(doc.root, lineIndex);
  if (!hit || hit.node === doc.root || !hit.parent || hit.parent === doc.root) return null;
  const { node, parent } = hit;

  const start = node.lineIndex;
  const end = subtreeEnd(doc, node);
  const block = doc.lines.slice(start, end);
  let pad: boolean;

  if (node.kind === 'heading') {
    if (parent.kind !== 'heading') return null;
    const delta = parent.level - node.level;
    // 只重写子树内已知的标题行（按节点 lineIndex 定位），代码块里的 # 行不受影响
    const rewrite = (n: MindNode): void => {
      if (n.kind === 'heading') {
        block[n.lineIndex - start] = headingLine(Math.max(1, Math.min(n.level + delta, 6)), n.text);
      }
      for (const c of n.children) rewrite(c);
    };
    rewrite(node);
    pad = true;
  } else {
    if (parent.kind !== 'list') return null;
    const line = listSiblingLine(doc.lines[parent.lineIndex]);
    if (!line) return null;
    block[0] = `${line}${node.text}`;
    pad = false;
  }

  let target = subtreeEnd(doc, parent);
  const removed = removeLines(doc.lines, start, end);
  // removeLines 的接缝清理可能比 (end-start) 多删一行，用实际长度差校正
  const shrink = doc.lines.length - removed.length;
  if (target >= end) target -= shrink;
  const { out } = insertLines(removed, Math.min(target, removed.length), block, pad);
  return out.join('\n');
}
