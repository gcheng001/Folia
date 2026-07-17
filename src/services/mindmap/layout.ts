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
  horizontalSpacing: 120,
  minVerticalSpacing: 26,
  rootX: 100,
  rootY: 0,
  nodeMaxWidth: 340,
} as const;

function nodeKey(node: MindNode): string {
  return `n${node.lineIndex}`;
}

function textUnits(text: string): number {
  return Array.from(text).reduce((sum, char) => {
    if (/\s/u.test(char)) return sum + 0.35;
    if ((char.codePointAt(0) ?? 0) <= 0xff) return sum + 0.58;
    return sum + 1;
  }, 0);
}

export interface MindMapNodeSize {
  width: number;
  height: number;
}

/** 与 CustomNode 的字体、内边距和最大宽度一致的确定性尺寸估算。 */
export function measureMindMapNode(
  node: MindNode,
  isRoot = node.kind === 'root',
): MindMapNodeSize {
  const fontSize = isRoot ? 16 : 14;
  const horizontalPadding = isRoot ? 40 : 32;
  const verticalPadding = isRoot ? 22 : 18;
  const minWidth = isRoot ? 120 : 96;
  const minHeight = isRoot ? 48 : 42;
  const maxContentWidth = LAYOUT_CONFIG.nodeMaxWidth - horizontalPadding;
  const paragraphs = (node.text || '未命名').split('\n');
  const widestUnits = Math.max(...paragraphs.map(textUnits), 1);
  const contentWidth = Math.min(maxContentWidth, Math.max(fontSize * 4, widestUnits * fontSize));
  const width = Math.min(
    LAYOUT_CONFIG.nodeMaxWidth,
    Math.max(minWidth, Math.ceil(contentWidth + horizontalPadding)),
  );
  const unitsPerLine = Math.max(1, (width - horizontalPadding) / fontSize);
  const lineCount = paragraphs.reduce(
    (sum, paragraph) => sum + Math.max(1, Math.ceil(textUnits(paragraph) / unitsPerLine)),
    0,
  );
  const height = Math.max(minHeight, Math.ceil(lineCount * fontSize * 1.4 + verticalPadding));
  return { width, height };
}

function calculateSubtreeHeight(node: MindNode, root: MindNode): number {
  const nodeHeight = measureMindMapNode(node, node === root).height;
  if (node.children.length === 0) return nodeHeight;

  const childrenHeight = node.children.reduce((sum, child, index) => {
    const spacing = index < node.children.length - 1 ? LAYOUT_CONFIG.minVerticalSpacing : 0;
    return sum + calculateSubtreeHeight(child, root) + spacing;
  }, 0);

  return Math.max(childrenHeight, nodeHeight);
}

interface Position {
  x: number;
  y: number;
}

/** 先序遍历计算每个节点的画布坐标（父在左，子在右，水平树）。 */
function calculateHorizontalLayout(root: MindNode): Map<MindNode, Position> {
  const positions = new Map<MindNode, Position>();
  const calculatePositions = (node: MindNode, x: number, startY: number): void => {
    const nodeSize = measureMindMapNode(node, node === root);
    const subtreeHeight = calculateSubtreeHeight(node, root);
    positions.set(node, { x, y: startY + (subtreeHeight - nodeSize.height) / 2 });
    if (node.children.length === 0) return;

    const childrenHeight = node.children.reduce(
      (sum, child, index) => sum + calculateSubtreeHeight(child, root) +
        (index < node.children.length - 1 ? LAYOUT_CONFIG.minVerticalSpacing : 0),
      0,
    );
    let childStartY = startY + (subtreeHeight - childrenHeight) / 2;
    const childX = x + nodeSize.width + LAYOUT_CONFIG.horizontalSpacing;
    for (const child of node.children) {
      calculatePositions(child, childX, childStartY);
      childStartY += calculateSubtreeHeight(child, root) + LAYOUT_CONFIG.minVerticalSpacing;
    }
  };

  const rootHeight = calculateSubtreeHeight(root, root);
  calculatePositions(root, LAYOUT_CONFIG.rootX, LAYOUT_CONFIG.rootY - rootHeight / 2);
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
    const size = measureMindMapNode(node, node === root);
    nodes.push({
      id: nodeKey(node),
      position: pos,
      width: size.width,
      height: size.height,
      data: {
        // label 保持原始文本（编辑态输入框的初值）；空文本的占位展示由节点组件负责
        label: node.text,
        kind: node.kind,
        level: node.level,
        branchIndex,
        isRoot: node === root,
        /** 手拖布局 sidecar 使用内容路径；重命名失配时自然回退自动布局。 */
        positionKey: node.id,
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
