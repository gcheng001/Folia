/**
 * 脑图布局算法（自澄脉 `layoutAlgorithm.ts` 移植，M-B 只读画布用）。
 * 纯函数，零 React 依赖。输入 `MindMapDoc.root`（MindNode 树），输出 React Flow
 * 的 `{nodes, edges}`。
 *
 * 与澄脉原版的差异：
 * - 澄脉操作扁平 `Record<string, Node>` + 手动定位/折叠状态；M-B 是只读画布，
 *   直接对 `MindNode` 树做先序遍历，不支持手动定位、不支持折叠。
 * - 节点 key 不用 `MindNode.id`（内容路径，重命名会变），改用 `lineIndex`
 *   （types.ts 明确标注的稳定画布 key）。
 */
import type { Edge, Node } from '@xyflow/react';
import type { MindNode } from './types';

const LAYOUT_CONFIG = {
  horizontalSpacing: 50,
  minVerticalSpacing: 20,
  baseNodeHeight: 60,
  rootX: 100,
  rootY: 0,
  nodeMaxWidth: 300,
  nodeMinWidth: 80,
  nodePadding: 20,
  fontSize: 14,
} as const;

function nodeKey(node: MindNode): string {
  return `n${node.lineIndex}`;
}

function estimateNodeWidth(node: MindNode): number {
  const textLength = node.text.length;
  if (textLength === 0) return LAYOUT_CONFIG.nodeMinWidth;

  const avgCharWidth = LAYOUT_CONFIG.fontSize * 0.6;
  const textWidth = avgCharWidth * textLength;
  const totalWidth = textWidth + 30;

  return Math.min(LAYOUT_CONFIG.nodeMaxWidth, Math.max(LAYOUT_CONFIG.nodeMinWidth, totalWidth));
}

function estimateNodeHeight(node: MindNode): number {
  const textLength = node.text.length;
  if (textLength === 0) return LAYOUT_CONFIG.baseNodeHeight;

  const availableWidth = LAYOUT_CONFIG.nodeMaxWidth - 30;
  const avgCharWidth = LAYOUT_CONFIG.fontSize * 0.6;
  const charsPerLine = Math.floor(availableWidth / avgCharWidth);
  const effectiveCharsPerLine = Math.max(10, Math.floor(charsPerLine * 0.85));
  const estimatedLines = Math.max(1, Math.ceil(textLength / effectiveCharsPerLine));

  const lineHeight = LAYOUT_CONFIG.fontSize * 1.4;
  const contentHeight = lineHeight * estimatedLines + LAYOUT_CONFIG.nodePadding;

  return Math.max(LAYOUT_CONFIG.baseNodeHeight, contentHeight);
}

function calculateSubtreeHeight(node: MindNode): number {
  if (node.children.length === 0) return estimateNodeHeight(node);

  const childrenHeight = node.children.reduce((sum, child, index) => {
    const spacing = index < node.children.length - 1 ? LAYOUT_CONFIG.minVerticalSpacing : 0;
    return sum + calculateSubtreeHeight(child) + spacing;
  }, 0);

  return Math.max(childrenHeight, estimateNodeHeight(node));
}

interface Position {
  x: number;
  y: number;
}

/** 先序遍历计算每个节点的画布坐标（父在左，子在右，水平树）。 */
function calculateHorizontalLayout(root: MindNode): Map<MindNode, Position> {
  const positions = new Map<MindNode, Position>();
  positions.set(root, { x: LAYOUT_CONFIG.rootX, y: LAYOUT_CONFIG.rootY });

  const calculatePositions = (node: MindNode, startY: number): void => {
    if (node.children.length === 0) return;

    let currentY = startY;
    const parentPos = positions.get(node)!;
    const childX = parentPos.x + estimateNodeWidth(node) + LAYOUT_CONFIG.horizontalSpacing;

    for (const child of node.children) {
      const subtreeHeight = calculateSubtreeHeight(child);
      const childY = currentY + subtreeHeight / 2;
      positions.set(child, { x: childX, y: childY });
      calculatePositions(child, currentY);
      currentY += subtreeHeight;
    }

    const firstChildY = positions.get(node.children[0])!.y;
    const lastChildY = positions.get(node.children[node.children.length - 1])!.y;
    positions.set(node, { x: parentPos.x, y: (firstChildY + lastChildY) / 2 });
  };

  calculatePositions(root, LAYOUT_CONFIG.rootY - calculateSubtreeHeight(root) / 2);
  return positions;
}

/** 布局计算 + React Flow 节点/边生成，一步到位。M-B 只读画布唯一入口。 */
export function layoutMindMap(root: MindNode): { nodes: Node[]; edges: Edge[] } {
  const positions = calculateHorizontalLayout(root);
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // branchIndex：节点所属一级分支（根的第几个孩子）的下标；根自身为 -1。
  // 主题按一级分支轮转配色（节点下划线与入边同色）。
  const walk = (node: MindNode, branchIndex: number): void => {
    const pos = positions.get(node) ?? { x: LAYOUT_CONFIG.rootX, y: LAYOUT_CONFIG.rootY };
    nodes.push({
      id: nodeKey(node),
      position: pos,
      data: {
        label: node.text || '(未命名)',
        kind: node.kind,
        level: node.level,
        branchIndex,
        isRoot: node === root,
      },
    });

    node.children.forEach((child, i) => {
      const childBranch = node === root ? i : branchIndex;
      edges.push({
        id: `e${node.lineIndex}-${child.lineIndex}`,
        source: nodeKey(node),
        target: nodeKey(child),
        data: { branchIndex: childBranch },
      });
      walk(child, childBranch);
    });
  };

  walk(root, -1);
  return { nodes, edges };
}
