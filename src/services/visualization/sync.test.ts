import { describe, expect, it } from 'vitest';
import { createVisualWorkbookDraft } from './draft';
import { buildSourceCorrection, refreshWorkbookFromSource } from './sync';
import { VISUALIZATION_RULES_VERSION } from './schema';

describe('visual workbook source sync', () => {
  it('builds an explicit correction without mutating the source', () => {
    const source = '# 错误标题\n正文';
    const workbook = createVisualWorkbookDraft({ markdown: source, sourceName: 'a.md', now: 1 });
    const element = workbook.sheets[0].elements.find((item) => item.kind === 'node')!;
    const correction = buildSourceCorrection(element, '正确标题', source);
    expect(correction?.before).toBe('# 错误标题');
    expect(correction?.after).toBe('# 正确标题');
    expect(correction?.sourceAfter).toBe('# 正确标题\n正文');
    expect(source).toBe('# 错误标题\n正文');
  });

  it('refuses to guess when an anchor is ambiguous', () => {
    const source = '前言\n# 同名\n# 同名';
    const workbook = createVisualWorkbookDraft({ markdown: '# 同名', sourceName: 'a.md', now: 1 });
    const element = workbook.sheets[0].elements.find((item) => item.kind === 'node')!;
    expect(buildSourceCorrection(element, '新名', source)).toBeNull();
  });

  it('refreshes anchors while preserving stable layout and presentation', () => {
    const source = '# 总览\n## 焦点';
    const workbook = createVisualWorkbookDraft({ markdown: source, sourceName: 'a.md', now: 1 });
    const node = workbook.sheets[0].elements.find((item) => item.kind === 'node')!;
    workbook.sheets[0].layout[node.id] = { x: 12, y: 34 };
    workbook.sheets[0].presentation[node.id] = { label: '展示名' };
    const refreshed = refreshWorkbookFromSource(workbook, `前言\n${source}`, 2);
    const stable = refreshed.sheets[0].elements.find((item) => item.id === node.id)!;
    expect(stable.anchor.start).toBeGreaterThan(node.anchor.start);
    expect(refreshed.sheets[0].layout[node.id]).toEqual({ x: 12, y: 34 });
    expect(refreshed.sheets[0].presentation[node.id]).toEqual({ label: '展示名' });
    expect(refreshed.rulesVersion).toBe(VISUALIZATION_RULES_VERSION);
  });
});
