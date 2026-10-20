import { describe, expect, it } from 'vitest';
import { createSourceAnchor, fingerprint, parseMarkdownBlocks, resolveSourceAnchor } from './source';

describe('visualization source helpers', () => {
  it('produces stable fingerprints for unicode content', () => {
    expect(fingerprint('同一份 Markdown')).toBe(fingerprint('同一份 Markdown'));
    expect(fingerprint('同一份 Markdown')).not.toBe(fingerprint('另一份 Markdown'));
    expect(fingerprint('x')).toHaveLength(16);
  });

  it('validates and uniquely relocates anchors', () => {
    const source = '# 标题\n事实发生于2024年1月2日';
    const excerpt = '2024年1月2日';
    const start = source.indexOf(excerpt);
    const anchor = createSourceAnchor({ source, start, end: start + excerpt.length, blockKind: 'paragraph' });
    expect(resolveSourceAnchor(anchor, source).status).toBe('valid');

    const prefix = '新增一行\n';
    const changed = `${prefix}${source}`;
    const resolution = resolveSourceAnchor(anchor, changed);
    expect(resolution.status).toBe('relocated');
    if (resolution.status === 'relocated') expect(resolution.anchor.start).toBe(start + prefix.length);
  });

  it('does not guess when an excerpt is missing or duplicated', () => {
    const source = '唯一事实';
    const anchor = createSourceAnchor({ source, start: 0, end: source.length, blockKind: 'paragraph' });
    expect(resolveSourceAnchor(anchor, '已被删除').status).toBe('missing');
    const duplicate = resolveSourceAnchor(anchor, '前缀\n唯一事实\n唯一事实');
    expect(duplicate.status).toBe('ambiguous');
    if (duplicate.status === 'ambiguous') expect(duplicate.matches).toBe(2);
  });

  it('keeps fenced code as one block', () => {
    const blocks = parseMarkdownBlocks('# 标题\n```txt\n2024年1月2日 假数据\n```\n正文');
    expect(blocks.map((block) => block.kind)).toEqual(['heading', 'fenced-code', 'paragraph']);
  });
});
