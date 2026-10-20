import { describe, expect, it } from 'vitest';
import { evaluateFamily, extractFamily } from './families';
import { parseMarkdownBlocks } from './source';
import type { ViewFamily } from './types';

function extract(family: ViewFamily, source: string) {
  return extractFamily(family, source, parseMarkdownBlocks(source));
}

describe('visualization families', () => {
  it('extracts a traceable hierarchy', () => {
    const source = '# 总览\n## 焦点\n- 证据';
    const result = extract('structure-overview', source);
    expect(result.elements.filter((element) => element.kind === 'node')).toHaveLength(3);
    expect(result.elements.filter((element) => element.kind === 'edge')).toHaveLength(2);
    expect(evaluateFamily('structure-overview', source, parseMarkdownBlocks(source)).score).toBeGreaterThan(0);
  });

  it('extracts each dated line with an exact anchor', () => {
    const source = '2024年1月2日 签约。\n2024年2月3日 交付。';
    const result = extract('timeline', source);
    expect(result.elements.map((element) => element.anchor.excerpt)).toEqual(source.split('\n'));
    expect(result.elements.map((element) => element.data.date)).toEqual(['2024年1月2日', '2024年2月3日']);
    expect(result.elements.map((element) => element.label)).toEqual(['签约。', '交付。']);
    expect(evaluateFamily('timeline', source, parseMarkdownBlocks(source)).score).toBeGreaterThan(0);
  });

  it('sorts legal events chronologically and excludes analysis repetitions', () => {
    const source = [
      '2025.6.30 被申请人以达到退休年龄为由停止用工。',
      '2012.7.13 马长梅入职并建立劳动关系。',
      '2012.7.13 工龄约13年（截至2025.6.30）。',
      '**分析日期**：2026-7-10（开庭日）',
      '2012.8 被申请人开始为马长梅缴纳工伤保险。',
    ].join('\n');
    const result = extract('timeline', source);
    expect(result.elements.map((element) => element.data.date)).toEqual(['2012.7.13', '2012.8', '2025.6.30']);
    expect(result.elements.map((element) => element.label)).toEqual([
      '马长梅入职并建立劳动关系。',
      '被申请人开始为马长梅缴纳工伤保险。',
      '被申请人以达到退休年龄为由停止用工。',
    ]);
  });

  it('prefers an explicit facts timeline section over dates in legal analysis', () => {
    const source = [
      '# 一、案件事实',
      '## 时间线与客观事实',
      '2024年1月2日 双方签订合同。',
      '## 请求与分析',
      '2020年10月8日 某类案作出判决。',
      '2025年6月30日可能涉及某项请求。',
    ].join('\n');
    const result = extract('timeline', source);
    expect(result.elements.map((element) => element.data.date)).toEqual(['2024年1月2日']);
  });

  it('creates relationship edges only for explicit verbs and reuses entities', () => {
    const source = '张三向李四支付100元。\n张三向王五交付货物。';
    const result = extract('relationship', source);
    expect(result.elements.filter((element) => element.kind === 'node')).toHaveLength(3);
    expect(result.elements.filter((element) => element.kind === 'edge')).toHaveLength(2);
    expect(result.elements.every((element) => element.anchor.excerpt.length > 0)).toBe(true);
    expect(evaluateFamily('relationship', source, parseMarkdownBlocks(source)).score).toBeGreaterThan(0);
  });

  it('recognizes an explicit arrow relation in a relationship section', () => {
    const source = '# 案件\n## 法律关系对\n**马长梅 → 康德莱公司**（劳动者对用人单位）';
    const result = extract('relationship', source);
    expect(result.elements.filter((element) => element.kind === 'node').map((element) => element.label)).toEqual(['马长梅', '康德莱公司']);
    expect(result.elements.find((element) => element.kind === 'edge')?.label).toBe('劳动者对用人单位');
  });

  it('sends ambiguous relationship language to review instead of forging an edge', () => {
    const result = extract('relationship', '张三与某项目存在一些情况。');
    expect(result.elements).toHaveLength(0);
    expect(result.review).toHaveLength(1);
  });

  it('extracts numbered flow steps and explicit sequential edges', () => {
    const source = '1. 提交申请\n2. 审查材料\n3. 作出决定';
    const result = extract('flow', source);
    expect(result.elements.filter((element) => element.kind === 'node')).toHaveLength(3);
    expect(result.elements.filter((element) => element.kind === 'edge')).toHaveLength(2);
    expect(evaluateFamily('flow', source, parseMarkdownBlocks(source)).score).toBeGreaterThan(0);
  });

  it('recognizes layer-style steps in an explicit review procedure section', () => {
    const source = '# 大纲\n## 检视程式大纲\n- **第一层（产生）**：审查权利产生\n- **第二层（未消灭）**：审查消灭事由\n- **第三层（可行使）**：审查时效';
    const result = extract('flow', source);
    expect(result.elements.filter((element) => element.kind === 'node')).toHaveLength(3);
    expect(result.elements.filter((element) => element.kind === 'edge')).toHaveLength(2);
  });

  it('strips paired bold markers from flow step labels', () => {
    const source = '# 大纲\n## 检视程式大纲\n- **第一层**检视\n- **第二层**审查';
    const result = extract('flow', source);
    const labels = result.elements.filter((element) => element.kind === 'node').map((element) => element.label);
    expect(labels).toEqual(['第一层检视', '第二层审查']);
  });

  it('strips paired inline emphasis from timeline event labels', () => {
    const source = '2024年1月2日 **签订**劳动合同。\n2024年2月3日 *发放*首月工资。';
    const result = extract('timeline', source);
    expect(result.elements.map((element) => element.label)).toEqual(['签订劳动合同。', '发放首月工资。']);
  });

  it('strips nested paired emphasis completely', () => {
    // 外层加粗包裹内层斜体，剥完后内层斜体也被剥净；且符合第…层格式，能被 flow 识别
    const source = '# 大纲\n## 检视程式大纲\n- **第*一*层**：审查权利产生\n- **第*二*层**：审查消灭事由';
    const result = extract('flow', source);
    const labels = result.elements.filter((element) => element.kind === 'node').map((element) => element.label);
    expect(labels).toEqual(['第一层', '第二层']);
  });

  it('strips strikethrough and inline code paired markers', () => {
    const source = '| ~~作废~~主体 | `代码`人 |\n| --- | --- |\n| 甲 | 乙 |';
    const result = extract('matrix', source);
    const labels = result.elements.filter((element) => element.kind === 'matrix-cell').map((element) => element.label);
    // ~~作废~~主体 → 作废主体；`代码`人 → 代码人
    expect(labels).toContain('作废主体');
    expect(labels).toContain('代码人');
  });

  it('does not strip isolated markdown characters that are not paired emphasis', () => {
    // 审查产品*标识：单侧 * 不成对，保留星号；1. 前缀能被 NUMBERED_STEP 识别
    const source = '# 流程\n## 步骤\n1. 审查产品*标识\n2. 确认完成';
    const result = extract('flow', source);
    const labels = result.elements.filter((element) => element.kind === 'node').map((element) => element.label);
    expect(labels).toContain('审查产品*标识');
  });

  it('extracts non-empty matrix cells with cell-level anchors', () => {
    const source = '| 主体 | 金额 |\n| --- | --- |\n| 甲方 | 100元 |\n| 乙方 | 200元 |';
    const result = extract('matrix', source);
    expect(result.elements.filter((element) => element.kind === 'matrix-cell')).toHaveLength(6);
    expect(result.elements.some((element) => element.anchor.excerpt === '100元')).toBe(true);
    expect(evaluateFamily('matrix', source, parseMarkdownBlocks(source)).score).toBeGreaterThan(0);
  });

  it('extracts positive and negative chart values without inventing points', () => {
    const source = '收入：120万元\n支出：-30万元';
    const result = extract('charts', source);
    expect(result.elements.map((element) => element.data.value)).toEqual([120, -30]);
    expect(evaluateFamily('charts', source, parseMarkdownBlocks(source)).score).toBeGreaterThan(0);
  });
});
