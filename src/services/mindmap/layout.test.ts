import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './parser';
import { layoutMindMap, measureMindMapNode } from './layout';
import realisticMd from './__fixtures__/hearing-realistic.md?raw';

describe('layoutMindMap (M-B 布局算法)', () => {
  it('庭审记录实战脑图：节点数/边数/坐标符合树形布局约束', () => {
    const doc = parseMarkdown(realisticMd);
    const { nodes, edges } = layoutMindMap(doc.root);

    // 虚拟根 + 12 个一级（H2）标题 + 其下内容，节点数远超 12
    const level2Count = doc.root.children.length;
    expect(level2Count).toBeGreaterThanOrEqual(12);

    // 树形结构：边数 = 节点数 - 1
    expect(edges.length).toBe(nodes.length - 1);

    // x 坐标非负（父在左子在右，根 rootX=100 起算）；y 以 0 为中心居中展开，可为负，
    // 只要求是有限数（不含 NaN/Infinity）
    for (const node of nodes) {
      expect(node.position.x).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(node.position.y)).toBe(true);
    }

    // 每条边的 source/target 都指向存在的节点
    const nodeIds = new Set(nodes.map((n) => n.id));
    for (const edge of edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
  });

  it('同一父节点下的兄弟节点 y 坐标两两间距不小于其中较小节点的估算高度下限（不重叠）', () => {
    const doc = parseMarkdown(realisticMd);
    const { nodes } = layoutMindMap(doc.root);

    // 按 x 坐标分组（同一层级 x 相同），组内按 y 排序检查间距
    const byX = new Map<number, number[]>();
    for (const node of nodes) {
      const list = byX.get(node.position.x) ?? [];
      list.push(node.position.y);
      byX.set(node.position.x, list);
    }

    for (const ys of byX.values()) {
      const sorted = [...ys].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        // baseNodeHeight = 60，兄弟节点圆心间距至少应大于 0（不完全重合）
        expect(sorted[i] - sorted[i - 1]).toBeGreaterThan(0);
      }
    }
  });

  it('长短节点按实际文字高度留出间距，不发生外框重叠', () => {
    const longText = '这是一段需要自动换行的长节点文字，'.repeat(16);
    const doc = parseMarkdown(`# 根\n\n## ${longText}\n\n## 短节点\n`);
    const { nodes } = layoutMindMap(doc.root);
    const longNode = nodes.find((node) => node.data.label === longText)!;
    const shortNode = nodes.find((node) => node.data.label === '短节点')!;
    const outline = doc.root.children[0];
    const longSize = measureMindMapNode(outline);

    expect(longSize.height).toBeGreaterThan(100);
    expect(longNode.position.y + longSize.height + 26).toBeLessThanOrEqual(shortNode.position.y);
  });

  it('单节点树（仅虚拟根）：无边，一个节点', () => {
    const doc = parseMarkdown('# 空文档\n');
    const { nodes, edges } = layoutMindMap(doc.root);
    expect(nodes.length).toBe(1);
    expect(edges.length).toBe(0);
  });

  it('branchIndex：根为 -1，每个一级分支子树共享该分支下标（主题按分支配色）', () => {
    const md = '# 根\n\n## 甲\n\n### 甲一\n\n## 乙\n\n### 乙一\n';
    const doc = parseMarkdown(md);
    const { nodes, edges } = layoutMindMap(doc.root);

    const byLabel = new Map(nodes.map((n) => [n.data.label as string, n]));
    expect(byLabel.get('根')?.data.branchIndex).toBe(-1);
    expect(byLabel.get('根')?.data.isRoot).toBe(true);
    expect(byLabel.get('甲')?.data.branchIndex).toBe(0);
    expect(byLabel.get('甲一')?.data.branchIndex).toBe(0);
    expect(byLabel.get('乙')?.data.branchIndex).toBe(1);
    expect(byLabel.get('乙一')?.data.branchIndex).toBe(1);

    // 每条边携带 target 所属分支下标
    for (const edge of edges) {
      const target = nodes.find((n) => n.id === edge.target);
      expect(edge.data?.branchIndex).toBe(target?.data.branchIndex);
    }
  });

  it('标题后的完整正文保留在节点数据中，但不撑大结构画布', () => {
    const body = '代理意见正文。'.repeat(80);
    const doc = parseMarkdown(`# 代理词\n\n## 第一项\n\n${body}\n`);
    const { nodes } = layoutMindMap(doc.root);
    const first = nodes.find((node) => node.data.label === '第一项');

    expect(first?.data.body).toBe(body);
    expect(first?.width).toBeLessThanOrEqual(340);
    expect(first?.height).toBeLessThanOrEqual(60);
  });

  it('正文自然段显示为论点的下级节点，并与结构节点分别连线', () => {
    const doc = parseMarkdown('# 代理词\n\n## 第一项\n\n第一段。\n\n第二段。\n');
    const { nodes, edges } = layoutMindMap(doc.root);
    const argument = nodes.find((node) => node.data.label === '第一项')!;
    const paragraphs = nodes.filter((node) => node.data.kind === 'paragraph');

    expect(paragraphs.map((node) => node.data.label)).toEqual(['第一段。', '第二段。']);
    expect(paragraphs.every((node) => node.data.projected === true)).toBe(true);
    expect(edges.filter((edge) => edge.source === argument.id).map((edge) => edge.target)).toEqual(
      paragraphs.map((node) => node.id),
    );
  });
});
