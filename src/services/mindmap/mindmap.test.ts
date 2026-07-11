import { describe, expect, it } from 'vitest';
import { parseMarkdown, collectOutlineNodes } from './parser';
import { serializeMarkdown } from './serializer';
import type { MindMapDoc } from './types';
import templateMd from './__fixtures__/hearing-template.md?raw';
import realisticMd from './__fixtures__/hearing-realistic.md?raw';
import edgeMd from './__fixtures__/edge-cases.md?raw';

/** 节点指纹列表：先序 DFS 的 [level, kind, text]，用于结构相等比较。 */
function fingerprints(doc: MindMapDoc): Array<{ level: number; kind: string; text: string }> {
  return collectOutlineNodes(doc.root).map((n) => ({ level: n.level, kind: n.kind, text: n.text }));
}

describe('mindmap 解析/序列化内核 (M-A)', () => {
  describe('往返不变式 serialize(parse(md)) === md', () => {
    it('庭审记录空白模板（4 级标题 + 列表 + key:value）', () => {
      expect(serializeMarkdown(parseMarkdown(templateMd))).toBe(templateMd);
    });

    it('庭审记录实战脑图（脱敏后 58 标题 / 5 层深 / 临时插入同级章节）', () => {
      const doc = parseMarkdown(realisticMd);
      expect(serializeMarkdown(doc)).toBe(realisticMd);
    });

    it('边缘用例合集（frontmatter/代码块/表格/引用/嵌套列表/三性/wiki）', () => {
      expect(serializeMarkdown(parseMarkdown(edgeMd))).toBe(edgeMd);
    });
  });

  describe('幂等：parse ∘ serialize ∘ parse 结构稳定', () => {
    for (const [name, md] of [
      ['template', templateMd],
      ['realistic', realisticMd],
      ['edge', edgeMd],
    ] as const) {
      it(name, () => {
        const doc1 = parseMarkdown(md);
        const doc2 = parseMarkdown(serializeMarkdown(doc1));
        expect(fingerprints(doc1)).toEqual(fingerprints(doc2));
        expect(serializeMarkdown(doc2)).toBe(md);
      });
    }
  });

  describe('庭审模板结构', () => {
    const doc = parseMarkdown(templateMd);

    it('单个 H1 提升为根（"庭审记录..."）', () => {
      expect(doc.root.kind).toBe('heading');
      expect(doc.root.level).toBe(1);
      expect(doc.root.text).toContain('庭审记录');
    });

    it('一级节点为十个编号章节', () => {
      const h2 = doc.root.children.filter((n) => n.level === 2);
      expect(h2.length).toBe(10);
      expect(h2[0].text).toBe('一、案件信息');
      expect(h2[9].text).toBe('十、需补充事项');
    });

    it('四级标题存在（发问内容/材料名称/补交事项）', () => {
      const nodes = collectOutlineNodes(doc.root);
      expect(nodes.some((n) => n.level === 4 && n.text === '发问内容')).toBe(true);
      expect(nodes.some((n) => n.level === 4 && n.text === '材料名称')).toBe(true);
    });

    it('列表项挂为最近标题的子节点（案号 → __________）', () => {
      const caseNo = collectOutlineNodes(doc.root).find((n) => n.text === '案号');
      expect(caseNo).toBeTruthy();
      expect(caseNo!.children.length).toBe(1);
      expect(caseNo!.children[0].kind).toBe('list');
    });
  });

  describe('实战脑图结构（脱敏 fixture）', () => {
    const doc = parseMarkdown(realisticMd);

    it('节点总数与标题分布符合 1×H1 + 12×H2 + 37×H3 + 8×H4', () => {
      const nodes = collectOutlineNodes(doc.root);
      const heads = nodes.filter((n) => n.kind === 'heading');
      const byLevel = [1, 2, 3, 4].map((lvl) => heads.filter((n) => n.level === lvl).length);
      expect(byLevel).toEqual([1, 12, 37, 8]);
    });

    it('临时插入的同级章节与编号章节平级（回应 / 保险公司质证）', () => {
      const h2 = doc.root.children.filter((n) => n.level === 2).map((n) => n.text);
      expect(h2).toContain('回应');
      expect(h2).toContain('保险公司质证');
      // 顺序：三、答辩意见 → 回应 → 四、原告举证 …（庭上实录的真实混乱）
      expect(h2.indexOf('回应')).toBeGreaterThan(h2.indexOf('三、答辩意见'));
      expect(h2.indexOf('回应')).toBeLessThan(h2.indexOf('四、原告举证'));
    });

    it('深度最深达 5 层（H1→H2→H3→H4→list）', () => {
      const nodes = collectOutlineNodes(doc.root);
      const maxLevel = Math.max(...nodes.map((n) => n.level));
      expect(maxLevel).toBeGreaterThanOrEqual(5);
    });
  });

  describe('边缘用例：非大纲内容不误解析', () => {
    const doc = parseMarkdown(edgeMd);
    const nodes = collectOutlineNodes(doc.root);
    const texts = nodes.map((n) => n.text);

    it('代码块内的 # / - 不产生标题或列表节点', () => {
      expect(texts).not.toContain('这一行在代码块里，不是标题');
      expect(texts).not.toContain('这一行在代码块里，不是列表项');
    });

    it('frontmatter 不产生节点', () => {
      expect(texts).not.toContain('边缘用例合集');
    });

    it('表格、引用块不产生节点（逐行原样保留由往返保证）', () => {
      // 表格行与引用行若被误识别会变成文本异常的节点；往返已证明原样。
      // 这里只确认它们没成为独立列表/标题节点。
      expect(nodes.filter((n) => n.text.startsWith('|'))).toHaveLength(0);
    });
  });

  describe('领域字段抽取（3.3，字段在所在行节点上，text 原样不变）', () => {
    const doc = parseMarkdown(edgeMd);
    const find = (t: string) => collectOutlineNodes(doc.root).find((n) => n.text.includes(t))!;

    it('#证据 #争点 命中类型词表（在标题行）', () => {
      expect(find('证据节点').types).toContain('证据');
      expect(find('争点节点').types).toContain('争点');
    });

    it('词表外 #重点（标题行）与 #待核实（列表项行）归为自由标签', () => {
      expect(find('证据节点').tags).toContain('重点');
      expect(find('待核实事项').tags).toContain('待核实');
    });

    it('[[文件]] 与 [[文件#锚]] 抽为他文件引用（在列表项行）', () => {
      expect(find('案件材料/借条').refs.some((r) => r.target === '案件材料/借条')).toBe(true);
      expect(find('跨文件带锚引用').refs.some((r) => r.target === '其他文件' && r.anchor === '锚')).toBe(true);
    });

    it('[[#本文件锚]] 抽为关联线（不进 refs）', () => {
      const linkNode = find('关联到本文件内锚点');
      expect(linkNode.links).toContain('结构与备注');
      expect(linkNode.refs).toHaveLength(0);
    });

    it('三性命中词表记录 verdict', () => {
      expect(find('真实性：认可').evidence?.真实性).toBe('认可');
      expect(find('合法性：不认可').evidence?.合法性).toBe('不认可');
      expect(find('关联性：部分认可').evidence?.关联性).toBe('部分认可');
    });
  });

  describe('嵌套列表深度', () => {
    const doc = parseMarkdown(edgeMd);
    const a = collectOutlineNodes(doc.root).find((n) => n.text === '一级项 A');
    it('二级项挂为一级项子节点（深度 +1）', () => {
      expect(a?.children.map((c) => c.text)).toEqual(['二级项 A1', '二级项 A2']);
      expect(a?.children[0].level).toBe(a!.level + 1);
    });
  });

  describe('多 H1 → 虚拟根', () => {
    it('两个 H1 时保留虚拟根，两者均作一级节点', () => {
      const doc = parseMarkdown(edgeMd);
      // edge-cases 有两个 H1（根节点 + 第二个 H1），不提升、保留虚拟根
      const h1s = collectOutlineNodes(doc.root).filter((n) => n.level === 1 && n.kind === 'heading');
      expect(h1s.length).toBe(2);
    });
  });

  describe('空文档与无大纲文档', () => {
    it('空字符串往返', () => {
      expect(serializeMarkdown(parseMarkdown(''))).toBe('');
    });
    it('仅 frontmatter 往返', () => {
      const md = '---\ntitle: x\n---\n';
      expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
    });
    it('无标题的纯段落往返', () => {
      const md = '第一段。\n\n第二段。\n';
      expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
    });
    it('id 基于内容路径生成', () => {
      const doc = parseMarkdown(templateMd);
      const caseNo = collectOutlineNodes(doc.root).find((n) => n.text === '案号');
      expect(caseNo?.id).toContain('庭审记录');
      expect(caseNo?.id).toContain('案号');
    });
  });
});

describe('Codex 审查回归（M-B 开工前修复）', () => {
  it('P0-1: 段落打断列表后，新项挂回标题而非旧列表项', () => {
    const doc = parseMarkdown('# H\n- a\nnote\n- b\n');
    expect(doc.root.text).toBe('H');
    expect(doc.root.children.map((c) => c.text)).toEqual(['a', 'b']);
    expect(doc.root.children[0].children).toHaveLength(0);
  });

  it('P0-2: 缩进回退到 base 以下，新项挂回标题', () => {
    const doc = parseMarkdown('# H\n  - a\n- b\n');
    expect(doc.root.children.map((c) => c.text)).toEqual(['a', 'b']);
  });

  it('P1-3: thematic break（* * *）不识别为列表项', () => {
    const md = '# H\n* * *\n- item\n';
    const doc = parseMarkdown(md);
    const texts = collectOutlineNodes(doc.root).map((n) => n.text);
    expect(texts).not.toContain('* * *');
    expect(texts).toContain('item');
    expect(serializeMarkdown(doc)).toBe(md);
  });

  it('P1-4: 4 反引号围栏不被内部 3 反引号提前关闭', () => {
    const md = ['````', '```', '````', '- after'].join('\n') + '\n';
    const doc = parseMarkdown(md);
    const texts = collectOutlineNodes(doc.root).map((n) => n.text);
    expect(texts).not.toContain('```');
    expect(texts).toContain('after');
    expect(serializeMarkdown(doc)).toBe(md);
  });

  it('P2-5: 三性行值不在词表时不留空 evidence 对象', () => {
    const doc = parseMarkdown('- 真实性：待核实\n');
    const node = collectOutlineNodes(doc.root)[0];
    expect(node.evidence).toBeUndefined();
    expect(node.text).toBe('真实性：待核实');
  });

  it('P0-3: 列表项内缩进段落是 lazy 续接，后续子列表仍挂该项下（Codex 第二轮反例）', () => {
    const md = '# H\n- parent\n  note\n  - child\n';
    const doc = parseMarkdown(md);
    const parent = doc.root.children.find((n) => n.text === 'parent');
    expect(parent?.children.map((c) => c.text)).toEqual(['child']);
    expect(serializeMarkdown(doc)).toBe(md);
  });

  it('P0-4: 列表项续接段落后再来同级项，仍为兄弟', () => {
    const md = '# H\n- a\n  note\n- b\n';
    const doc = parseMarkdown(md);
    expect(doc.root.children.map((c) => c.text)).toEqual(['a', 'b']);
  });

  it('P1-6: 带 info string 的围栏行（```text）不闭合当前围栏', () => {
    const md = ['```', '```text', '```', '- after'].join('\n') + '\n';
    const doc = parseMarkdown(md);
    const texts = collectOutlineNodes(doc.root).map((n) => n.text);
    expect(texts).toContain('after');
    expect(serializeMarkdown(doc)).toBe(md);
  });

  it('P0 回归：庭审实战 fixture 仍往返保真（修复未破坏既有）', () => {
    expect(serializeMarkdown(parseMarkdown(realisticMd))).toBe(realisticMd);
  });

  it('P0-7: 未缩进 lazy 续行后的缩进子项仍挂父项下（Codex 第三轮反例，pandoc 交叉验证）', () => {
    // `note` 是 parent 的 lazy 续行（无空行分隔）→ 列表不打断 → `  - child` 嵌到 parent 下
    const md = '# H\n- parent\nnote\n  - child\n- sibling\n';
    const doc = parseMarkdown(md);
    const parent = doc.root.children.find((n) => n.text === 'parent');
    expect(parent?.children.map((c) => c.text)).toEqual(['child']);
    expect(parent?.children[0].level).toBe(parent!.level + 1);
    expect(doc.root.children.map((c) => c.text)).toEqual(['parent', 'sibling']);
    expect(serializeMarkdown(doc)).toBe(md);
  });

  it('P0-8: 空行后的未缩进段落才打断列表（与 lazy 续行区分）', () => {
    // 空行关闭 lazy 续行窗口 → note 跳出列表 → b 作为新列表段挂到 H（不嵌到 a 下）
    const md = '# H\n- a\n\nnote\n  - b\n';
    const doc = parseMarkdown(md);
    const a = doc.root.children.find((n) => n.text === 'a');
    expect(a?.children).toHaveLength(0);
    expect(doc.root.children.map((c) => c.text)).toEqual(['a', 'b']);
    expect(serializeMarkdown(doc)).toBe(md);
  });

  it('P0-9: 多项 lazy 续行后回兄弟项仍平级（Codex Case C）', () => {
    const md = '# H\n- a\n- b\nmore\n  - bchild\n- c\n';
    const doc = parseMarkdown(md);
    const b = doc.root.children.find((n) => n.text === 'b');
    expect(b?.children.map((c) => c.text)).toEqual(['bchild']);
    expect(doc.root.children.map((c) => c.text)).toEqual(['a', 'b', 'c']);
    expect(serializeMarkdown(doc)).toBe(md);
  });
});

describe('Codex 第四轮复核回归', () => {
  it('R4-P0-1: 段落打断列表后弹出列表栈，更深标题挂回原标题而非旧列表项', () => {
    const md = '# H\n- a\n\nnote\n### sub\n';
    const doc = parseMarkdown(md);
    expect(doc.root.children.map((c) => c.text)).toEqual(['a', 'sub']);
    const a = doc.root.children.find((n) => n.text === 'a');
    expect(a?.children).toHaveLength(0);
    expect(serializeMarkdown(doc)).toBe(md);
  });

  it('R4-P0-2: 列表项内缩进围栏不打断列表，其后子项仍挂原项下', () => {
    const md = ['# H', '- a', '  ```', '  code', '  ```', '  - child'].join('\n') + '\n';
    const doc = parseMarkdown(md);
    const a = doc.root.children.find((n) => n.text === 'a');
    expect(a?.children.map((c) => c.text)).toEqual(['child']);
    expect(doc.root.children.map((c) => c.text)).toEqual(['a']);
    expect(serializeMarkdown(doc)).toBe(md);
  });

  it('R4-P0-2b: 顶格围栏仍打断列表（对照组）', () => {
    const md = ['# H', '- a', '```', 'code', '```', '- b'].join('\n') + '\n';
    const doc = parseMarkdown(md);
    expect(doc.root.children.map((c) => c.text)).toEqual(['a', 'b']);
    const a = doc.root.children.find((n) => n.text === 'a');
    expect(a?.children).toHaveLength(0);
    expect(serializeMarkdown(doc)).toBe(md);
  });

  it('R4-P0-3: tab 缩进的子项挂父项下（tab 按 4 列展开）', () => {
    const md = '# H\n- a\n\t- child\n';
    const doc = parseMarkdown(md);
    const a = doc.root.children.find((n) => n.text === 'a');
    expect(a?.children.map((c) => c.text)).toEqual(['child']);
    expect(serializeMarkdown(doc)).toBe(md);
  });

  it('R4-P0-4: 内容列按最近一项计算（多位序号），不足缩进的段落跳出列表', () => {
    const md = '# H\n1. a\n10. b\n\n   para\n   - c\n';
    const doc = parseMarkdown(md);
    expect(doc.root.children.map((c) => c.text)).toEqual(['a', 'b', 'c']);
    const b = doc.root.children.find((n) => n.text === 'b');
    expect(b?.children).toHaveLength(0);
    expect(serializeMarkdown(doc)).toBe(md);
  });

  it('R4 回归：全部 fixture 仍往返保真', () => {
    for (const md of [templateMd, realisticMd, edgeMd]) {
      expect(serializeMarkdown(parseMarkdown(md))).toBe(md);
    }
  });
});
