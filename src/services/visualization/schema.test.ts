import { describe, expect, it } from 'vitest';
import {
  createEmptyVisualWorkbook,
  importExternalWorkbook,
  parseVisualWorkbook,
  serializeVisualWorkbook,
  VisualWorkbookValidationError,
} from './schema';
import { fingerprint } from './source';

describe('visual workbook schema', () => {
  it('round-trips a new workbook deterministically', () => {
    const workbook = createEmptyVisualWorkbook({
      title: '案件时间线',
      relativeSourcePath: './case.md',
      sourceHash: 'abc',
      now: 100,
    });
    expect(parseVisualWorkbook(serializeVisualWorkbook(workbook))).toEqual(workbook);
  });

  it('preserves unknown fields for forward compatibility', () => {
    const workbook = createEmptyVisualWorkbook({ title: 'x', relativeSourcePath: 'x.md', sourceHash: 'h', now: 1 });
    const input = { ...workbook, futureField: { enabled: true } };
    const parsed = parseVisualWorkbook(input) as unknown as Record<string, unknown>;
    expect(parsed.futureField).toEqual({ enabled: true });
  });

  it('reports all useful paths for corrupted input', () => {
    expect(() => parseVisualWorkbook({ kind: 'wrong', schemaVersion: 99, source: null }))
      .toThrow(VisualWorkbookValidationError);
    try {
      parseVisualWorkbook({ kind: 'wrong', schemaVersion: 99, source: null });
    } catch (error) {
      const issuePaths = (error as VisualWorkbookValidationError).issues.map((issue) => issue.path);
      expect(issuePaths).toContain('$.kind');
      expect(issuePaths).toContain('$.source');
      expect(issuePaths).toContain('$.sheets');
    }
  });

  it('rejects formal elements without a source anchor', () => {
    const workbook = createEmptyVisualWorkbook({ title: 'x', relativeSourcePath: 'x.md', sourceHash: 'h', now: 1 });
    const broken = {
      ...workbook,
      sheets: [{
        id: 's1', family: 'timeline', templateId: 'timeline', name: '时间轴',
        elements: [{ id: 'e1', kind: 'event', label: '无来源', data: {} }],
        annotations: [], reviewItems: [], presentation: {}, layout: {}, createdAt: 1, updatedAt: 1,
      }],
    };
    expect(() => parseVisualWorkbook(broken)).toThrow(/来源锚点/);
  });

  it('rejects a forged excerpt fingerprint', () => {
    const workbook = createEmptyVisualWorkbook({ title: 'x', relativeSourcePath: 'x.md', sourceHash: 'h', now: 1 });
    const broken = {
      ...workbook,
      sheets: [{
        id: 's1', family: 'timeline', templateId: 'timeline', name: '时间轴',
        elements: [{
          id: 'e1', kind: 'event', label: '事实', data: {},
          anchor: { excerpt: '事实', excerptHash: 'forged', start: 0, end: 2, blockKind: 'paragraph', headingPath: [] },
        }],
        annotations: [], reviewItems: [], presentation: {}, layout: {}, createdAt: 1, updatedAt: 1,
      }],
    };
    expect(() => parseVisualWorkbook(broken)).toThrow(/原文摘录不匹配/);
  });
});

describe('importExternalWorkbook (lenient import)', () => {
  const sourceMarkdown = `# 案件概要

## 时间线
2024年1月15日，甲与乙签订合同。

## 事实
甲向乙支付了款项。

## 结论
合同有效。`;

  it('excerpt correct but hash/offset missing — all elements located, hash recomputed, demotedCount 0', () => {
    const external = {
      kind: 'folia.visual.workbook',
      schemaVersion: 1,
      rulesVersion: 'agent-1.0.0',
      source: { relativePath: 'case.md', contentHash: 'abc' },
      title: '外部导入工作簿',
      sheets: [{
        id: 'sheet-1',
        family: 'timeline',
        templateId: 'timeline',
        name: '时间轴',
        elements: [{
          kind: 'event',
          label: '签订合同',
          // excerpt 正确，但 excerptHash/start/end 故意缺失
          anchor: { excerpt: '2024年1月15日，甲与乙签订合同。' },
        }],
        annotations: [],
        reviewItems: [],
        presentation: {},
        layout: {},
        createdAt: 1,
        updatedAt: 1,
      }],
      activeSheetId: null,
      createdAt: 1,
      updatedAt: 1,
    };

    const result = importExternalWorkbook(external, sourceMarkdown);
    expect(result.demotedCount).toBe(0);
    expect(result.workbook.sheets[0].elements).toHaveLength(1);
    expect(result.workbook.sheets[0].elements[0].anchor.excerptHash).toBeTruthy();
    expect(result.workbook.sheets[0].elements[0].anchor.start).toBeGreaterThan(0);
    expect(result.workbook.sheets[0].elements[0].anchor.end).toBeGreaterThan(result.workbook.sheets[0].elements[0].anchor.start);
    expect(result.workbook.rulesVersion).toBe('agent-1.0.0');
  });

  it('partial excerpt not found in source — corresponding elements demoted as unsupported', () => {
    const external = {
      kind: 'folia.visual.workbook',
      schemaVersion: 1,
      rulesVersion: 'agent-1.0.0',
      source: { relativePath: 'case.md', contentHash: 'abc' },
      title: '外部导入工作簿',
      sheets: [{
        id: 'sheet-1',
        family: 'timeline',
        templateId: 'timeline',
        name: '时间轴',
        elements: [
          {
            id: 'e1',
            kind: 'event',
            label: '签订合同',
            anchor: { excerpt: '2024年1月15日，甲与乙签订合同。' },
          },
          {
            id: 'e2',
            kind: 'event',
            label: '不存在的摘录',
            anchor: { excerpt: '这个摘录在源文件中根本不存在。' },
          },
        ],
        annotations: [],
        reviewItems: [],
        presentation: {},
        layout: {},
        createdAt: 1,
        updatedAt: 1,
      }],
      activeSheetId: null,
      createdAt: 1,
      updatedAt: 1,
    };

    const result = importExternalWorkbook(external, sourceMarkdown);
    expect(result.demotedCount).toBe(1);
    expect(result.workbook.sheets[0].elements).toHaveLength(1);
    expect(result.workbook.sheets[0].reviewItems).toHaveLength(1);
    expect(result.workbook.sheets[0].reviewItems[0].reason).toBe('unsupported');
    expect(result.workbook.sheets[0].reviewItems[0].label).toBe('不存在的摘录');
  });

  it('element with missing excerpt — demoted as incomplete', () => {
    const external = {
      kind: 'folia.visual.workbook',
      schemaVersion: 1,
      rulesVersion: 'agent-1.0.0',
      source: { relativePath: 'case.md', contentHash: 'abc' },
      title: '外部导入工作簿',
      sheets: [{
        id: 'sheet-1',
        family: 'timeline',
        templateId: 'timeline',
        name: '时间轴',
        elements: [
          {
            id: 'e1',
            kind: 'event',
            label: '签订合同',
            // anchor 缺少 excerpt
            anchor: { excerptHash: 'whatever', start: 0, end: 10, blockKind: 'paragraph', headingPath: [] },
          },
        ],
        annotations: [],
        reviewItems: [],
        presentation: {},
        layout: {},
        createdAt: 1,
        updatedAt: 1,
      }],
      activeSheetId: null,
      createdAt: 1,
      updatedAt: 1,
    };

    const result = importExternalWorkbook(external, sourceMarkdown);
    expect(result.demotedCount).toBe(1);
    expect(result.workbook.sheets[0].elements).toHaveLength(0);
    expect(result.workbook.sheets[0].reviewItems[0].reason).toBe('incomplete');
  });

  it('all elements fail to locate — workbook still returned with demotedCount equal to total', () => {
    const external = {
      kind: 'folia.visual.workbook',
      schemaVersion: 1,
      rulesVersion: 'agent-1.0.0',
      source: { relativePath: 'case.md', contentHash: 'abc' },
      title: '全失配工作簿',
      sheets: [{
        id: 'sheet-1',
        family: 'timeline',
        templateId: 'timeline',
        name: '时间轴',
        elements: [
          { id: 'e1', kind: 'event', label: '元素A', anchor: { excerpt: '完全找不到的内容A' } },
          { id: 'e2', kind: 'event', label: '元素B', anchor: { excerpt: '完全找不到的内容B' } },
        ],
        annotations: [],
        reviewItems: [],
        presentation: {},
        layout: {},
        createdAt: 1,
        updatedAt: 1,
      }],
      activeSheetId: null,
      createdAt: 1,
      updatedAt: 1,
    };

    const result = importExternalWorkbook(external, sourceMarkdown);
    expect(result.workbook.sheets[0].elements).toHaveLength(0);
    expect(result.workbook.sheets[0].reviewItems).toHaveLength(2);
    expect(result.demotedCount).toBe(2);
    // 工作簿仍可打开
    expect(result.workbook.kind).toBe('folia.visual.workbook');
    expect(result.workbook.title).toBe('全失配工作簿');
  });

  it('invalid JSON — throws VisualWorkbookValidationError', () => {
    expect(() => importExternalWorkbook('not json at all', sourceMarkdown))
      .toThrow(VisualWorkbookValidationError);
  });

  it('wrong kind — throws VisualWorkbookValidationError', () => {
    expect(() => importExternalWorkbook({ kind: 'wrong.kind', schemaVersion: 1, rulesVersion: '1.0' }, sourceMarkdown))
      .toThrow(VisualWorkbookValidationError);
  });

  it('wrong schemaVersion — throws VisualWorkbookValidationError', () => {
    expect(() => importExternalWorkbook({ kind: 'folia.visual.workbook', schemaVersion: 99, rulesVersion: '1.0' }, sourceMarkdown))
      .toThrow(VisualWorkbookValidationError);
  });

  it('rulesVersion accepts agent-<spec> form', () => {
    const external = {
      kind: 'folia.visual.workbook',
      schemaVersion: 1,
      rulesVersion: 'agent-1.0.0',
      source: { relativePath: 'case.md', contentHash: 'abc' },
      title: 'Test',
      sheets: [],
      activeSheetId: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const result = importExternalWorkbook(external, sourceMarkdown);
    expect(result.workbook.rulesVersion).toBe('agent-1.0.0');
  });

  it('element id missing — generates id', () => {
    const external = {
      kind: 'folia.visual.workbook',
      schemaVersion: 1,
      rulesVersion: 'agent-1.0.0',
      source: { relativePath: 'case.md', contentHash: 'abc' },
      title: 'Test',
      sheets: [{
        id: 'sheet-1',
        family: 'timeline',
        templateId: 'timeline',
        name: '时间轴',
        elements: [{
          kind: 'event',
          label: '签订合同',
          anchor: { excerpt: '2024年1月15日，甲与乙签订合同。' },
          // id 缺失
        }],
        annotations: [],
        reviewItems: [],
        presentation: {},
        layout: {},
        createdAt: 1,
        updatedAt: 1,
      }],
      activeSheetId: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const result = importExternalWorkbook(external, sourceMarkdown);
    expect(result.workbook.sheets[0].elements[0].id).toBeTruthy();
  });

  it('createdAt/updatedAt missing — filled with current time', () => {
    const external = {
      kind: 'folia.visual.workbook',
      schemaVersion: 1,
      rulesVersion: 'agent-1.0.0',
      source: { relativePath: 'case.md', contentHash: 'abc' },
      title: 'Test',
      sheets: [{
        id: 'sheet-1',
        family: 'timeline',
        templateId: 'timeline',
        name: '时间轴',
        elements: [{
          kind: 'event',
          label: '签订合同',
          anchor: { excerpt: '2024年1月15日，甲与乙签订合同。' },
        }],
        annotations: [],
        reviewItems: [],
        presentation: {},
        layout: {},
        // createdAt/updatedAt 缺失
      }],
      activeSheetId: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const result = importExternalWorkbook(external, sourceMarkdown);
    expect(result.workbook.sheets[0].createdAt).toBeGreaterThan(0);
    expect(result.workbook.sheets[0].updatedAt).toBeGreaterThan(0);
  });

  it('ambiguous excerpt — demoted as ambiguous', () => {
    // "事实" 在源文件中出现两次，resolveSourceAnchor 应返回 ambiguous
    const ambiguousSource = `# 案件概要\n\n## 事实\n第一次出现。\n\n## 事实\n第二次出现。\n\n## 其他\n事实相关内容。`;
    const external = {
      kind: 'folia.visual.workbook',
      schemaVersion: 1,
      rulesVersion: 'agent-1.0.0',
      source: { relativePath: 'case.md', contentHash: 'abc' },
      title: 'Test',
      sheets: [{
        id: 'sheet-1',
        family: 'timeline',
        templateId: 'timeline',
        name: '时间轴',
        elements: [{
          id: 'e1',
          kind: 'event',
          label: '事实',
          anchor: { excerpt: '事实' }, // 在 ambiguousSource 中出现 3 次
        }],
        annotations: [],
        reviewItems: [],
        presentation: {},
        layout: {},
        createdAt: 1,
        updatedAt: 1,
      }],
      activeSheetId: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const result = importExternalWorkbook(external, ambiguousSource);
    expect(result.demotedCount).toBe(1);
    expect(result.workbook.sheets[0].reviewItems[0].reason).toBe('ambiguous');
  });

  it('strict parseVisualWorkbook — zero regression: valid workbook with correct anchors parses without error', () => {
    const valid = {
      kind: 'folia.visual.workbook',
      schemaVersion: 1,
      rulesVersion: '1.3.0',
      source: { relativePath: 'x.md', contentHash: 'h' },
      title: 'x',
      sheets: [{
        id: 's1', family: 'timeline', templateId: 'timeline', name: '时间轴',
        elements: [{
          id: 'e1', kind: 'event', label: '事实', data: {},
          anchor: { excerpt: '事实', excerptHash: fingerprint('事实'), start: 0, end: 2, blockKind: 'paragraph', headingPath: [] },
        }],
        annotations: [], reviewItems: [], presentation: {}, layout: {}, createdAt: 1, updatedAt: 1,
      }],
      activeSheetId: null,
      createdAt: 1,
      updatedAt: 1,
    };
    // 不抛错即通过；验证严格路径未因宽容导入改动而回归
    expect(() => parseVisualWorkbook(valid)).not.toThrow();
  });
});
