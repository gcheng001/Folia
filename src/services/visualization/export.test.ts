import { describe, expect, it } from 'vitest';
import { createVisualWorkbookDraft } from './draft';
import { exportSheetSvg, exportWorkbookHtml } from './export';
import { extractFamily } from './families';
import { parseMarkdownBlocks } from './source';

describe('visualization export purification', () => {
  it('exports standalone HTML without traceability metadata or CSS Color 4', () => {
    const workbook = createVisualWorkbookDraft({ markdown: '# 机密标题\n## 内容', sourceName: '/Users/a/secret.md', now: 1 });
    const html = exportWorkbookHtml(workbook);
    expect(html).toContain('机密标题');
    expect(html).not.toContain('/Users/a/secret.md');
    expect(html).not.toContain('/Users/a');
    expect(html).not.toContain('excerptHash');
    expect(html).not.toContain('contentHash');
    expect(html).not.toContain('structure-0-0');
    expect(html).not.toMatch(/oklch|color-mix|oklab/i);
  });

  it('exports chart SVG with negative values and no internal ids', () => {
    const source = '收入：120万元\n支出：-30万元';
    const workbook = createVisualWorkbookDraft({ markdown: source, sourceName: 'a.md', now: 1 });
    const sheet = workbook.sheets[0];
    sheet.family = 'charts';
    sheet.elements = extractFamily('charts', source, parseMarkdownBlocks(source)).elements;
    const svg = exportSheetSvg(sheet)!;
    expect(svg).toContain('<svg');
    expect(svg).toContain('收入');
    expect(svg).not.toContain('chart-');
    expect(svg).not.toContain('excerpt');
  });

  it('limits SVG to applicable page types', () => {
    const workbook = createVisualWorkbookDraft({ markdown: '2024年1月2日 事件。\n2024年2月3日 事件。', sourceName: 'a.md', now: 1 });
    expect(exportSheetSvg(workbook.sheets[0])).toBeNull();
  });
});
