import { describe, expect, it } from 'vitest';
import { parseMarkdown, collectOutlineNodes } from './parser';
import { serializeMarkdown } from './serializer';
import {
  deleteNode,
  editNodeText,
  insertChild,
  insertSibling,
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

    it('六级标题的子节点仍为六级（层级封顶）', () => {
      const md = '###### 最深\n';
      const doc = parseMarkdown(md);
      const deep = collectOutlineNodes(doc.root).find((n) => n.text === '最深')!;
      const { markdown, newLineIndex } = insertChild(doc, deep.lineIndex);
      expect(markdown.split('\n')[newLineIndex]).toBe('###### ');
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
});
