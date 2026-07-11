import { describe, expect, it } from 'vitest';
import { parseMarkdown, collectOutlineNodes } from './parser';
import { serializeMarkdown } from './serializer';
import {
  deleteNode,
  editNodeText,
  insertChild,
  insertSibling,
  moveSubtreeAsLastChild,
  promoteNode,
} from './edit';

/** 每个编辑操作产物都必须满足往返不变式（MD 仍是唯一源）。 */
function assertStable(md: string): void {
  expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
}

describe('mindmap 编辑内核 (M-C，PRD 项 C)', () => {
  describe('editNodeText', () => {
    it('改标题文字只动该行，保留层级与正文', () => {
      const md = '# 报告\n\n## 第一章\n\n正文段落。\n';
      const doc = parseMarkdown(md);
      const ch = collectOutlineNodes(doc.root).find((n) => n.text === '第一章')!;
      const out = editNodeText(doc, ch.lineIndex, '第一章（改）');
      expect(out).toBe('# 报告\n\n## 第一章（改）\n\n正文段落。\n');
      assertStable(out);
    });

    it('改列表项文字保留缩进与 marker', () => {
      const md = '# 根\n\n- a\n  - b\n';
      const doc = parseMarkdown(md);
      const b = collectOutlineNodes(doc.root).find((n) => n.text === 'b')!;
      const out = editNodeText(doc, b.lineIndex, 'b2');
      expect(out).toBe('# 根\n\n- a\n  - b2\n');
      assertStable(out);
    });

    it('改文件名虚拟根时在 frontmatter 后插入真实 H1', () => {
      const md = '---\ncase: 2026\n---\n\n开篇正文。\n\n## 第一部分\n';
      const doc = parseMarkdown(md, '案件报告.md');
      expect(doc.root.kind).toBe('root');
      const out = editNodeText(doc, doc.root.lineIndex, '案件分析报告');
      expect(out).toBe('---\ncase: 2026\n---\n\n# 案件分析报告\n\n开篇正文。\n\n## 第一部分\n');
      expect(parseMarkdown(out ?? '').root.text).toBe('案件分析报告');
      assertStable(out ?? '');
    });
  });

  describe('insertSibling（Enter：同级空节点）', () => {
    it('标题节点：插到其子树末尾、下一个同级之前，带空行分隔', () => {
      const md = '# 根\n\n## 甲\n\n甲的正文。\n\n## 乙\n';
      const doc = parseMarkdown(md);
      const jia = collectOutlineNodes(doc.root).find((n) => n.text === '甲')!;
      const { markdown, newLineIndex } = insertSibling(doc, jia.lineIndex);
      const lines = markdown.split('\n');
      expect(lines[newLineIndex]).toBe('## ');
      // 新节点在甲的正文之后、乙之前
      expect(markdown.indexOf('甲的正文。')).toBeLessThan(markdown.indexOf('## \n'));
      expect(markdown.indexOf('## \n')).toBeLessThan(markdown.indexOf('## 乙'));
      // 重解析：根下三个 H2，中间是空文本节点
      const doc2 = parseMarkdown(markdown);
      expect(doc2.root.children.map((n) => n.text)).toEqual(['甲', '', '乙']);
      assertStable(markdown);
    });

    it('末尾节点：插到文档末尾', () => {
      const md = '# 根\n\n## 甲\n';
      const doc = parseMarkdown(md);
      const jia = collectOutlineNodes(doc.root).find((n) => n.text === '甲')!;
      const { markdown, newLineIndex } = insertSibling(doc, jia.lineIndex);
      expect(markdown.split('\n')[newLineIndex]).toBe('## ');
      const doc2 = parseMarkdown(markdown);
      expect(doc2.root.children.map((n) => n.text)).toEqual(['甲', '']);
      assertStable(markdown);
    });

    it('列表节点：同缩进同 marker，不加空行（不破坏列表段）', () => {
      const md = '# 根\n\n- a\n  - b\n- c\n';
      const doc = parseMarkdown(md);
      const b = collectOutlineNodes(doc.root).find((n) => n.text === 'b')!;
      const { markdown, newLineIndex } = insertSibling(doc, b.lineIndex);
      expect(markdown.split('\n')[newLineIndex]).toBe('  - ');
      const doc2 = parseMarkdown(markdown);
      const a = collectOutlineNodes(doc2.root).find((n) => n.text === 'a')!;
      expect(a.children.map((n) => n.text)).toEqual(['b', '']);
      assertStable(markdown);
    });

    it('根节点不允许插同级', () => {
      const doc = parseMarkdown('# 根\n\n## 甲\n');
      expect(insertSibling(doc, doc.root.lineIndex)).toBeNull();
    });
  });

  describe('insertChild（Tab：末位子节点）', () => {
    it('标题节点：子标题层级 +1，插到子树末尾', () => {
      const md = '# 根\n\n## 甲\n\n甲的正文。\n\n## 乙\n';
      const doc = parseMarkdown(md);
      const jia = collectOutlineNodes(doc.root).find((n) => n.text === '甲')!;
      const { markdown, newLineIndex } = insertChild(doc, jia.lineIndex);
      expect(markdown.split('\n')[newLineIndex]).toBe('### ');
      const doc2 = parseMarkdown(markdown);
      const jia2 = collectOutlineNodes(doc2.root).find((n) => n.text === '甲')!;
      expect(jia2.children.map((n) => n.text)).toEqual(['']);
      assertStable(markdown);
    });

    it('虚拟根（多段落文档）：追加一级标题到文档末尾', () => {
      const md = '引言段。\n\n# 第一部分\n\n# 第二部分\n';
      const doc = parseMarkdown(md, '文件.md');
      expect(doc.root.kind).toBe('root');
      const { markdown, newLineIndex } = insertChild(doc, doc.root.lineIndex);
      expect(markdown.split('\n')[newLineIndex]).toBe('# ');
      const doc2 = parseMarkdown(markdown, '文件.md');
      expect(doc2.root.children.map((n) => n.text)).toEqual(['第一部分', '第二部分', '']);
      assertStable(markdown);
    });

    it('列表节点：子项缩进到父项内容列（含有序列表宽 marker）', () => {
      const md = '# 根\n\n1. 项目一\n';
      const doc = parseMarkdown(md);
      const item = collectOutlineNodes(doc.root).find((n) => n.text === '项目一')!;
      const { markdown } = insertChild(doc, item.lineIndex);
      const doc2 = parseMarkdown(markdown);
      const item2 = collectOutlineNodes(doc2.root).find((n) => n.text === '项目一')!;
      // 子项必须真的嵌进去（缩进 ≥ 父内容列 3），而不是变成同级
      expect(item2.children.map((n) => n.text)).toEqual(['']);
      assertStable(markdown);
    });

    it('六级标题不可再插子节点（七级不存在，伪子节点会解析成兄弟）', () => {
      const md = '###### 最深\n';
      const doc = parseMarkdown(md);
      const deep = collectOutlineNodes(doc.root).find((n) => n.text === '最深')!;
      expect(insertChild(doc, deep.lineIndex)).toBeNull();
    });

    it('Tab 缩进的父列表项：子项按 4 列制表位展开的列宽缩进', () => {
      const md = '# 根\n\n- a\n\t- b\n';
      const doc = parseMarkdown(md);
      const b = collectOutlineNodes(doc.root).find((n) => n.text === 'b')!;
      const { markdown } = insertChild(doc, b.lineIndex);
      const doc2 = parseMarkdown(markdown);
      const b2 = collectOutlineNodes(doc2.root).find((n) => n.text === 'b')!;
      // b 的内容列 = tab(4 列) + marker(1) + padding(1) = 6，子项必须真的嵌进去
      expect(b2.children.map((n) => n.text)).toEqual(['']);
      assertStable(markdown);
    });
  });

  describe('deleteNode（Delete：整子树删除）', () => {
    it('删除标题节点连带正文与子标题，接缝不留双空行', () => {
      const md = '# 根\n\n## 甲\n\n甲正文。\n\n### 甲一\n\n## 乙\n';
      const doc = parseMarkdown(md);
      const jia = collectOutlineNodes(doc.root).find((n) => n.text === '甲')!;
      const out = deleteNode(doc, jia.lineIndex);
      expect(out).toBe('# 根\n\n## 乙\n');
      assertStable(out);
    });

    it('删除列表项连带嵌套子项', () => {
      const md = '# 根\n\n- a\n  - a1\n- b\n';
      const doc = parseMarkdown(md);
      const a = collectOutlineNodes(doc.root).find((n) => n.text === 'a')!;
      const out = deleteNode(doc, a.lineIndex);
      expect(out).toBe('# 根\n\n- b\n');
      assertStable(out);
    });

    it('根节点不允许删除', () => {
      const doc = parseMarkdown('# 根\n\n## 甲\n');
      expect(deleteNode(doc, doc.root.lineIndex)).toBeNull();
    });
  });

  describe('promoteNode（Shift+Tab：升一级，移到父节点之后）', () => {
    it('中间子标题升级：整子树移到父子树末尾，层级 -1，后续兄弟不受影响', () => {
      const md = '# 根\n\n## 父\n\n### X\n\nX正文。\n\n### Y\n';
      const doc = parseMarkdown(md);
      const x = collectOutlineNodes(doc.root).find((n) => n.text === 'X')!;
      const out = promoteNode(doc, x.lineIndex)!;
      const doc2 = parseMarkdown(out);
      expect(doc2.root.children.map((n) => n.text)).toEqual(['父', 'X']);
      const parent2 = doc2.root.children[0];
      expect(parent2.children.map((n) => n.text)).toEqual(['Y']);
      const x2 = doc2.root.children[1];
      expect(x2.level).toBe(2);
      // X 的正文跟着 X 走
      expect(out.indexOf('### Y')).toBeLessThan(out.indexOf('## X'));
      expect(out.indexOf('## X')).toBeLessThan(out.indexOf('X正文。'));
      assertStable(out);
    });

    it('子标题带自己的子树整体升级（孙标题同步 -1）', () => {
      const md = '## 父\n\n### X\n\n#### X1\n';
      const doc = parseMarkdown(md);
      const x = collectOutlineNodes(doc.root).find((n) => n.text === 'X')!;
      const out = promoteNode(doc, x.lineIndex)!;
      const doc2 = parseMarkdown(out);
      const x2 = collectOutlineNodes(doc2.root).find((n) => n.text === 'X')!;
      expect(x2.level).toBe(2);
      expect(x2.children[0].text).toBe('X1');
      expect(x2.children[0].level).toBe(3);
      assertStable(out);
    });

    it('一级标题 / 根节点不可升级', () => {
      const doc = parseMarkdown('# 根\n\n## 甲\n\n# 平级\n');
      const top = collectOutlineNodes(doc.root).find((n) => n.text === '平级')!;
      expect(promoteNode(doc, top.lineIndex)).toBeNull();
      expect(promoteNode(doc, doc.root.lineIndex)).toBeNull();
    });

    it('列表项升级：并入父项同级', () => {
      const md = '# 根\n\n- a\n  - b\n- c\n';
      const doc = parseMarkdown(md);
      const b = collectOutlineNodes(doc.root).find((n) => n.text === 'b')!;
      const out = promoteNode(doc, b.lineIndex)!;
      const doc2 = parseMarkdown(out);
      const rootKids = doc2.root.children.map((n) => n.text);
      expect(rootKids).toEqual(['a', 'b', 'c']);
      assertStable(out);
    });

    it('直属标题的列表项不可再升级', () => {
      const doc = parseMarkdown('# 根\n\n- a\n');
      const a = collectOutlineNodes(doc.root).find((n) => n.text === 'a')!;
      expect(promoteNode(doc, a.lineIndex)).toBeNull();
    });
  });

  describe('moveSubtreeAsLastChild（结构拖动：把 source 整棵子树作为 target 末位子节点）', () => {
    it('标题→标题：source 子树整体平移到 target 子树尾，level 抬到 target.level+1', () => {
      const md = '# 根\n\n## A\n\n### A1\n\n## B\n\n### B1\n';
      const doc = parseMarkdown(md);
      const a1 = collectOutlineNodes(doc.root).find((n) => n.text === 'A1')!;
      const b = collectOutlineNodes(doc.root).find((n) => n.text === 'B')!;
      const out = moveSubtreeAsLastChild(doc, a1.lineIndex, b.lineIndex)!;
      const doc2 = parseMarkdown(out);
      const b2 = collectOutlineNodes(doc2.root).find((n) => n.text === 'B')!;
      // A1 应作为 B 的最后一个子节点（level=3）
      expect(b2.children.map((c) => c.text)).toEqual(['B1', 'A1']);
      const a12 = b2.children[1];
      expect(a12.level).toBe(3);
      assertStable(out);
    });

    it('拒绝把根节点作为 source', () => {
      const doc = parseMarkdown('# 根\n\n## A\n');
      const a = collectOutlineNodes(doc.root).find((n) => n.text === 'A')!;
      expect(moveSubtreeAsLastChild(doc, doc.root.lineIndex, a.lineIndex)).toBeNull();
    });

    it('拒绝把节点移到自己或自己的后代', () => {
      const doc = parseMarkdown('# 根\n\n## A\n\n### A1\n');
      const a = collectOutlineNodes(doc.root).find((n) => n.text === 'A')!;
      const a1 = collectOutlineNodes(doc.root).find((n) => n.text === 'A1')!;
      expect(moveSubtreeAsLastChild(doc, a.lineIndex, a.lineIndex)).toBeNull();
      expect(moveSubtreeAsLastChild(doc, a.lineIndex, a1.lineIndex)).toBeNull();
    });

    it('跨种拖放（heading→list）拒绝', () => {
      const doc = parseMarkdown('# 根\n\n## A\n\n- a\n');
      const A = collectOutlineNodes(doc.root).find((n) => n.text === 'A')!;
      const a = collectOutlineNodes(doc.root).find((n) => n.text === 'a')!;
      expect(moveSubtreeAsLastChild(doc, A.lineIndex, a.lineIndex)).toBeNull();
    });

    it('层级越界拒绝：target 是 H5，source 含 H5/H6', () => {
      const md = '# 根\n\n##### 五\n\n###### 六\n\n## A\n';
      const doc = parseMarkdown(md);
      const source = collectOutlineNodes(doc.root).find((n) => n.text === '五')!;
      const a = collectOutlineNodes(doc.root).find((n) => n.text === 'A')!;
      // 源最高 H6，移到 A（H2）下需要 +1 层级 → H7，越界
      expect(moveSubtreeAsLastChild(doc, source.lineIndex, a.lineIndex)).toBeNull();
    });

    it('列表→列表：整棵子树重缩进到 target 内容列', () => {
      const md = '# 根\n\n- a\n  - a1\n- b\n';
      const doc = parseMarkdown(md);
      const a1 = collectOutlineNodes(doc.root).find((n) => n.text === 'a1')!;
      const b = collectOutlineNodes(doc.root).find((n) => n.text === 'b')!;
      const out = moveSubtreeAsLastChild(doc, a1.lineIndex, b.lineIndex)!;
      const doc2 = parseMarkdown(out);
      const b2 = collectOutlineNodes(doc2.root).find((n) => n.text === 'b')!;
      // a1 应真的嵌到 b 之下（不是同级）
      expect(b2.children.map((c) => c.text)).toEqual(['a1']);
      assertStable(out);
    });

    // P1-2 新增测试用例：前方同级→后方目标
    it('前方同级→后方目标：删除source后target行号漂移，需重新解析找回target', () => {
      const md = '# 根\n\n## A\n\n### A1\n\n## B\n\n### B1\n';
      const doc = parseMarkdown(md);
      const a1 = collectOutlineNodes(doc.root).find((n) => n.text === 'A1')!;
      const b = collectOutlineNodes(doc.root).find((n) => n.text === 'B')!;
      // A1 在 B 前面，删除 A1 后 B 的行号会改变
      const out = moveSubtreeAsLastChild(doc, a1.lineIndex, b.lineIndex)!;
      const doc2 = parseMarkdown(out);
      const b2 = collectOutlineNodes(doc2.root).find((n) => n.text === 'B')!;
      // A1 应作为 B 的最后一个子节点（level=3）
      expect(b2.children.map((c) => c.text)).toEqual(['B1', 'A1']);
      const a12 = b2.children[1];
      expect(a12.level).toBe(3);
      assertStable(out);
    });

    // P1-2 新增测试用例：深标题→浅目标（delta<0合法降级）
    it('深标题→浅目标：允许delta<0的合法标题重挂，只要新层级在1..6', () => {
      const md = '# 根\n\n## A\n\n### A1\n\n#### A1a\n\n## B\n';
      const doc = parseMarkdown(md);
      // A1 (H3) → B (H2) 会变成 H3（delta = 2+1-3 = 0）
      // A1a (H4) → B (H2) 会变成 H3（delta = 2+1-4 = -1，这是合法的降级）
      const a1a = collectOutlineNodes(doc.root).find((n) => n.text === 'A1a')!;
      const b = collectOutlineNodes(doc.root).find((n) => n.text === 'B')!;
      const out = moveSubtreeAsLastChild(doc, a1a.lineIndex, b.lineIndex)!;
      const doc2 = parseMarkdown(out);
      const b2 = collectOutlineNodes(doc2.root).find((n) => n.text === 'B')!;
      // A1a 应作为 B 的子节点，从 H4 降级到 H3
      expect(b2.children.map((c) => c.text)).toEqual(['A1a']);
      const a1a2 = b2.children[0];
      expect(a1a2.level).toBe(3);
      assertStable(out);
    });

    // P1-2 新增测试用例：H6越界拒绝
    it('H6越界拒绝：即使delta<0，如果新层级超出1..6也要拒绝', () => {
      // 构造一个场景：H6节点移到H1下会变成H2，但如果移到H5下会变成H6（合法）
      // 但如果整个子树中有节点会超出H6，应该拒绝
      const md = '# 根\n\n## A\n\n##### 五\n\n###### 六\n\n# B\n';
      const doc = parseMarkdown(md);
      const five = collectOutlineNodes(doc.root).find((n) => n.text === '五')!;
      const b = collectOutlineNodes(doc.root).find((n) => n.text === 'B')!;
      // 五 (H5) → B (H1) 会变成 H2（delta=-3）
      // 六 (H6) → B (H1) 会变成 H2（delta=-4），合法！
      const out = moveSubtreeAsLastChild(doc, five.lineIndex, b.lineIndex)!;
      const doc2 = parseMarkdown(out);
      const b2 = collectOutlineNodes(doc2.root).find((n) => n.text === 'B')!;
      // 五应该成功移动，层级从H5降到H2
      expect(b2.children.map((c) => c.text)).toEqual(['五']);
      const five2 = b2.children[0];
      expect(five2.level).toBe(2);
      // 六也应该从H6降到H3
      const six2 = five2.children[0];
      expect(six2.level).toBe(3);
      assertStable(out);
    });

    // P1-2 新增测试用例：往返稳定性
    it('往返稳定性：moveSubtreeAsLastChild后重解析应得到相同结构', () => {
      const md = '# 根\n\n## A\n\n### A1\n\n## B\n\n### B1\n\n### B2\n';
      const doc = parseMarkdown(md);
      const a1 = collectOutlineNodes(doc.root).find((n) => n.text === 'A1')!;
      const b2 = collectOutlineNodes(doc.root).find((n) => n.text === 'B2')!;
      // A1 → B2
      const out1 = moveSubtreeAsLastChild(doc, a1.lineIndex, b2.lineIndex)!;
      const doc2 = parseMarkdown(out1);
      // 再移回来：找到新的A1位置，移到根下（与A同级）
      const b22 = collectOutlineNodes(doc2.root).find((n) => n.text === 'B2')!;
      const a12 = collectOutlineNodes(doc2.root).find((n) => n.text === 'A1')!;
      const a2 = collectOutlineNodes(doc2.root).find((n) => n.text === 'A')!;
      const out2 = moveSubtreeAsLastChild(doc2, a12.lineIndex, a2.lineIndex)!;
      const doc3 = parseMarkdown(out2);
      // 最终结构应该恢复到 A 下有 A1
      const a3 = collectOutlineNodes(doc3.root).find((n) => n.text === 'A')!;
      expect(a3.children.map((c) => c.text)).toEqual(['A1']);
      assertStable(out2);
    });
  });
});
