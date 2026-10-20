import { describe, expect, it } from 'vitest';
import { addRecommendedSheet, createVisualWorkbookDraft, visualizationDraftName } from './draft';

describe('visual workbook draft', () => {
  it('creates an independent traceable timeline workbook', () => {
    const markdown = '# 经过\n2024年1月2日 签订合同。\n2024年2月3日 交付货物。\n2024年3月4日 发出催告。';
    const workbook = createVisualWorkbookDraft({ markdown, sourceName: '案件.md', now: 10 });
    expect(workbook.source.relativePath).toBe('案件.md');
    expect(workbook.sheets[0].family).toBe('timeline');
    expect(workbook.sheets[0].elements).toHaveLength(3);
    expect(workbook.sheets[0].elements.every((element) => element.anchor.excerpt.length > 0)).toBe(true);
    expect(workbook.recommendation?.fits[0].family).toBe('timeline');
  });

  it('uses structure overview for a heading document', () => {
    const workbook = createVisualWorkbookDraft({ markdown: '# 标题\n## 焦点\n- 证据', sourceName: 'a.markdown', now: 1 });
    expect(workbook.sheets[0].family).toBe('structure-overview');
    expect(workbook.sheets[0].elements.filter((element) => element.kind === 'node').map((element) => element.label)).toEqual(['标题', '焦点', '证据']);
    expect(workbook.sheets[0].elements.filter((element) => element.kind === 'edge')).toHaveLength(2);
    expect(visualizationDraftName('a.markdown')).toBe('a.foliaviz');
  });

  it('extracts a recommended sheet immediately when bound source is available', () => {
    const markdown = '1. 提交申请\n2. 审查材料\n3. 作出决定';
    const workbook = createVisualWorkbookDraft({ markdown, sourceName: '流程.md', sourcePath: '/tmp/流程.md', now: 1 });
    const next = addRecommendedSheet(workbook, 'flow', markdown, 2);
    expect(next.source.absolutePath).toBe('/tmp/流程.md');
    expect(next.sheets.find((sheet) => sheet.family === 'flow')?.elements.length).toBeGreaterThan(0);
    expect(next.sheets.find((sheet) => sheet.family === 'flow')?.reviewItems.some((item) => item.label.includes('等待重新绑定'))).toBe(false);
  });
});
