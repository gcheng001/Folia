/**
 * MindMapDoc → Markdown 序列化器。
 *
 * 往返不变式：serialize(parse(md)) === md（未经画布编辑时）。
 *
 * 实现原理：真实节点的先序 DFS 序列 == 它们在原文中的出现顺序。
 * 因此给每个节点发射「自己的 outline 行 → 下一个先序节点的 outline 行」
 * 之间的全部原文行，即逐行、按序、不重不漏地还原整个文档。
 * 虚拟根本身不发射行，仅由「首节点之前」的前缀行（frontmatter/首行前空白）
 * 承担。
 *
 * 这意味着 M-A 阶段（无编辑）序列化恒等；M-C 编辑阶段将改为按节点模型
 * 重建被改动的 outline 行与备注，未改动节点仍走原样区间。
 */

import type { MindMapDoc, MindNode } from './types';
import { collectOutlineNodes } from './parser';

export function serializeMarkdown(doc: MindMapDoc): string {
  const { lines } = doc;
  const ordered = collectOutlineNodes(doc.root);

  const out: string[] = [];

  // 前缀：第一个真实节点之前的全部行（frontmatter 等）。
  // 若文档没有任何真实节点（空文档/纯 frontmatter），整篇照发。
  const firstIdx = ordered.length > 0 ? ordered[0].lineIndex : lines.length;
  for (let i = 0; i < firstIdx; i++) out.push(lines[i]);

  // 每个节点发射 [lineIndex, 后继 lineIndex) 的原文行。
  for (let k = 0; k < ordered.length; k++) {
    const node = ordered[k];
    const end = k + 1 < ordered.length ? ordered[k + 1].lineIndex : lines.length;
    for (let i = node.lineIndex; i < end; i++) out.push(lines[i]);
  }

  return out.join('\n');
}

/** 先序 DFS 谓词版（供编辑期/渲染期复用）。当前 M-A 未使用。 */
export function walkPreOrder(root: MindNode, visit: (node: MindNode) => void): void {
  const recurse = (node: MindNode): void => {
    if (node.kind === 'heading' || node.kind === 'list') visit(node);
    for (const child of node.children) recurse(child);
  };
  recurse(root);
}
