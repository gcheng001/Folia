import type { AnchorResolution, MarkdownBlock, MarkdownBlockKind, SourceAnchor } from './types';

function mixHash(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function fingerprint(input: string): string {
  const left = mixHash(input, 0x811c9dc5).toString(16).padStart(8, '0');
  const right = mixHash(input, 0x9e3779b9).toString(16).padStart(8, '0');
  return `${left}${right}`;
}

export function createSourceAnchor(input: {
  source: string;
  start: number;
  end: number;
  blockKind: MarkdownBlockKind;
  headingPath?: string[];
}): SourceAnchor {
  if (input.start < 0 || input.end <= input.start || input.end > input.source.length) {
    throw new RangeError('来源锚点范围无效');
  }
  const excerpt = input.source.slice(input.start, input.end);
  return {
    excerpt,
    excerptHash: fingerprint(excerpt),
    start: input.start,
    end: input.end,
    blockKind: input.blockKind,
    headingPath: [...(input.headingPath ?? [])],
  };
}

export function resolveSourceAnchor(anchor: SourceAnchor, source: string): AnchorResolution {
  const exact = source.slice(anchor.start, anchor.end);
  if (exact === anchor.excerpt && fingerprint(exact) === anchor.excerptHash) {
    return { status: 'valid', anchor };
  }

  const matches: number[] = [];
  let cursor = 0;
  while (cursor <= source.length - anchor.excerpt.length) {
    const found = source.indexOf(anchor.excerpt, cursor);
    if (found === -1) break;
    matches.push(found);
    cursor = found + Math.max(1, anchor.excerpt.length);
  }
  if (matches.length === 0) return { status: 'missing', anchor };
  if (matches.length > 1) return { status: 'ambiguous', anchor, matches: matches.length };
  const start = matches[0];
  return {
    status: 'relocated',
    anchor: { ...anchor, start, end: start + anchor.excerpt.length },
  };
}

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const FENCE = /^[ \t]*(`{3,}|~{3,})/;
const LIST = /^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/;
const TABLE = /^[ \t]*\|.*\|[ \t]*$/;
const QUOTE = /^[ \t]*>/;

export function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  const lines = source.split('\n');
  const offsets: number[] = [];
  let offset = 0;
  lines.forEach((line) => {
    offsets.push(offset);
    offset += line.length + 1;
  });

  const blocks: MarkdownBlock[] = [];
  const headings: string[] = [];
  let fenceMarker: string | null = null;
  let fenceStart = 0;
  let fenceLine = 0;
  let paragraphStart: number | null = null;
  let firstContentLine = 0;

  const pushParagraph = (lineEnd: number) => {
    if (paragraphStart === null) return;
    const start = offsets[paragraphStart];
    const end = lineEnd + 1 < offsets.length ? offsets[lineEnd + 1] - 1 : source.length;
    blocks.push({ kind: 'paragraph', start, end, lineStart: paragraphStart, lineEnd, text: source.slice(start, end), headingPath: [...headings] });
    paragraphStart = null;
  };

  if (lines[0]?.trim() === '---') {
    const closingLine = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (closingLine > 0) {
      const end = closingLine + 1 < offsets.length ? offsets[closingLine + 1] - 1 : source.length;
      blocks.push({ kind: 'frontmatter', start: 0, end, lineStart: 0, lineEnd: closingLine, text: source.slice(0, end), headingPath: [] });
      firstContentLine = closingLine + 1;
    }
  }

  for (let lineIndex = firstContentLine; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const lineStart = offsets[lineIndex];
    const lineEnd = lineStart + line.length;
    const fence = line.match(FENCE)?.[1];
    if (fenceMarker) {
      if (fence && fence[0] === fenceMarker[0] && fence.length >= fenceMarker.length) {
        blocks.push({ kind: 'fenced-code', start: fenceStart, end: lineEnd, lineStart: fenceLine, lineEnd: lineIndex, text: source.slice(fenceStart, lineEnd), headingPath: [...headings] });
        fenceMarker = null;
      }
      continue;
    }
    if (fence) {
      pushParagraph(lineIndex - 1);
      fenceMarker = fence;
      fenceStart = lineStart;
      fenceLine = lineIndex;
      continue;
    }
    if (line.trim() === '') {
      pushParagraph(lineIndex - 1);
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      pushParagraph(lineIndex - 1);
      const level = heading[1].length;
      headings.length = Math.min(headings.length, level - 1);
      const label = heading[2].trim();
      headings[level - 1] = label;
      blocks.push({ kind: 'heading', start: lineStart, end: lineEnd, lineStart: lineIndex, lineEnd: lineIndex, text: line, headingPath: headings.slice(0, level - 1), headingLevel: level });
      continue;
    }
    const kind: MarkdownBlockKind | null = LIST.test(line) ? 'list-item' : TABLE.test(line) ? 'table' : QUOTE.test(line) ? 'blockquote' : null;
    if (kind) {
      pushParagraph(lineIndex - 1);
      blocks.push({ kind, start: lineStart, end: lineEnd, lineStart: lineIndex, lineEnd: lineIndex, text: line, headingPath: [...headings] });
      continue;
    }
    if (paragraphStart === null) paragraphStart = lineIndex;
  }
  pushParagraph(lines.length - 1);
  if (fenceMarker) {
    blocks.push({ kind: 'fenced-code', start: fenceStart, end: source.length, lineStart: fenceLine, lineEnd: lines.length - 1, text: source.slice(fenceStart), headingPath: [...headings] });
  }
  return blocks.sort((a, b) => a.start - b.start);
}
