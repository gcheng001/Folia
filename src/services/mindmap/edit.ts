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
import { collectOutlineNodes } from './parser';

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

/** 列表项的空子行：缩进到父项内容列（CommonMark：marker 末列 + min(padding, 4)）。 */
function listChildLine(parentLine: string): string | null {
  const m = parentLine.match(LIST_ITEM);
  if (!m) return null;
  const contentCol = m[1].length + m[2].length + Math.min(m[3].length, 4);
  return `${' '.repeat(contentCol)}- `;
}

/** 改节点文字：只重写该 outline 行，保留层级/缩进/marker。 */
export function editNodeText(doc: MindMapDoc, lineIndex: number, newText: string): string | null {
  const hit = locate(doc.root, lineIndex);
  if (!hit || lineIndex < 0) return null;
  const lines = [...doc.lines];
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
    const childLevel = node.kind === 'root' ? 1 : Math.min(node.level + 1, 6);
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
