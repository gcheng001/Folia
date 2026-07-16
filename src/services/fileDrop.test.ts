import { describe, expect, it } from 'vitest';
import { firstOpenableDocumentPath, isOpenableDocumentPath } from './fileDrop';

describe('fileDrop', () => {
  it('accepts Markdown, HTML, docx, foliaviz, and SVG paths', () => {
    expect(isOpenableDocumentPath('/tmp/case.md')).toBe(true);
    expect(isOpenableDocumentPath('/tmp/case.markdown')).toBe(true);
    expect(isOpenableDocumentPath('/tmp/case.HTML')).toBe(true);
    expect(isOpenableDocumentPath('/tmp/case.htm')).toBe(true);
    expect(isOpenableDocumentPath('/tmp/case.DOCX')).toBe(true);
    expect(isOpenableDocumentPath('/tmp/case.foliaviz')).toBe(true);
    expect(isOpenableDocumentPath('/tmp/case.FOLIAVIZ')).toBe(true);
    expect(isOpenableDocumentPath('/tmp/case.svg')).toBe(true);
    expect(isOpenableDocumentPath('/tmp/case.SVG')).toBe(true);
  });

  it('returns the first supported dropped path', () => {
    expect(firstOpenableDocumentPath(['/tmp/a.pdf', '/tmp/b.md', '/tmp/c.docx'])).toBe('/tmp/b.md');
    expect(firstOpenableDocumentPath(['/tmp/a.pdf', '/tmp/b.foliaviz', '/tmp/c.md'])).toBe('/tmp/b.foliaviz');
    expect(firstOpenableDocumentPath(['/tmp/a.pdf'])).toBeNull();
  });
});
