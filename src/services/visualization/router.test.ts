import { describe, expect, it } from 'vitest';
import { evaluateViews, recommendView } from './router';

describe('visualization view router', () => {
  it('uses structure overview as a heading-document fallback', () => {
    const result = recommendView('# 案件概况\n## 争议焦点\n- 焦点一\n## 证据');
    expect(result.primary.family).toBe('structure-overview');
    expect(result.mode).toBe('direct');
    expect(result.primary.evidence.find((item) => item.code === 'formal-element-count')?.count).toBe(4);
  });

  it('prefers a timeline when dates bind to real event text', () => {
    const source = [
      '# 案件经过',
      '2024年1月2日 双方签订合同。',
      '2024年2月3日 被告收到货物。',
      '2024年3月4日 原告发出催告函。',
    ].join('\n');
    const result = recommendView(source);
    expect(result.primary.family).toBe('timeline');
    expect(result.mode).toBe('direct');
    expect(result.primary.evidence.find((item) => item.code === 'formal-element-count')?.count).toBe(3);
  });

  it('ignores dates inside fenced code', () => {
    const source = '---\nupdated: 2024年1月1日\n---\n# 示例\n```text\n2024年1月2日 假事件\n2024年2月3日 假事件\n```';
    const fits = evaluateViews(source);
    expect(fits.find((fit) => fit.family === 'timeline')?.score).toBe(0);
    expect(fits[0].family).toBe('structure-overview');
  });

  it('returns byte-stable recommendations', () => {
    const source = '# 时间\n2024年1月2日 立案。\n2024年2月3日 开庭。';
    expect(JSON.stringify(recommendView(source))).toBe(JSON.stringify(recommendView(source)));
  });

  it('keeps enabled families non-competitive without explicit source signals', () => {
    const fits = evaluateViews('普通正文');
    const relationship = fits.find((fit) => fit.family === 'relationship');
    expect(relationship?.score).toBe(0);
    expect(relationship?.missing).toEqual(['至少需要 1 个可追溯元素']);
  });
});
