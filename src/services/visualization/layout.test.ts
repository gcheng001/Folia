import { describe, expect, it } from 'vitest';
import { focusGraph } from './layout';
import {
  EDGE_STATUS_STYLES,
  LEGAL_CANVAS_ORIGIN,
  LEGAL_CJK_WIDTH_PX,
  LEGAL_NODE_MAX_WIDTH_PX,
  chineseNodeWidth,
  edgeStatusStyle,
  legalPaletteCssVars,
  nodeSizing,
} from './legalVisuals';
import type { SourceAnchor, TraceableElement, VisualSheet } from './types';

const anchor = (start: number): SourceAnchor => ({
  excerpt: `原文-${start}`,
  excerptHash: `hash-${start}`,
  start,
  end: start + 1,
  blockKind: 'heading',
  headingPath: [],
});

function node(id: string, start: number, level = 3): TraceableElement {
  return { id, kind: 'node', label: id, anchor: anchor(start), data: { level } };
}

function edge(id: string, from: string, to: string): TraceableElement {
  return { id, kind: 'edge', label: '关系', anchor: anchor(0), data: { from, to } };
}

function sheet(family: VisualSheet['family'], elements: TraceableElement[]): VisualSheet {
  return {
    id: 'sheet', family, templateId: family, name: '测试', elements,
    annotations: [], reviewItems: [], presentation: {}, layout: {}, createdAt: 1, updatedAt: 1,
  };
}

describe('visualization graph focus', () => {
  it('keeps high-level structure nodes in the default readable view', () => {
    const nodes = Array.from({ length: 24 }, (_, index) => node(`n${index}`, index, index < 3 ? 1 : 4));
    const edges = nodes.slice(1).map((item, index) => edge(`e${index}`, nodes[0].id, item.id));
    const focused = focusGraph(sheet('structure-overview', [...nodes, ...edges]), false, 8);
    expect(focused.nodes).toHaveLength(8);
    expect(focused.nodes.slice(0, 3).map((item) => item.id)).toEqual(['n0', 'n1', 'n2']);
    expect(focused.hiddenNodeCount).toBe(16);
    expect(focused.edges.every((item) => focused.nodes.some((candidate) => candidate.id === item.data.to))).toBe(true);
  });

  it('prioritizes connected entities in a relationship view', () => {
    const nodes = Array.from({ length: 8 }, (_, index) => node(`n${index}`, index));
    const edges = [edge('e1', 'n7', 'n1'), edge('e2', 'n7', 'n2'), edge('e3', 'n7', 'n3')];
    const focused = focusGraph(sheet('relationship', [...nodes, ...edges]), false, 3);
    expect(focused.nodes.map((item) => item.id)).toContain('n7');
  });

  it('returns the complete graph after explicit expansion', () => {
    const nodes = Array.from({ length: 22 }, (_, index) => node(`n${index}`, index));
    const focused = focusGraph(sheet('flow', nodes), true);
    expect(focused.nodes).toHaveLength(22);
    expect(focused.hiddenNodeCount).toBe(0);
  });
});

describe('nodeSizing tier switching (legalVisuals)', () => {
  it('returns tier A (160x70) for 1-7 nodes', () => {
    expect(nodeSizing(1)).toEqual({ width: 160, height: 70, hGap: 220, vGap: 160 });
    expect(nodeSizing(7)).toEqual({ width: 160, height: 70, hGap: 220, vGap: 160 });
  });
  it('returns tier B (140x60) for 8-15 nodes', () => {
    expect(nodeSizing(8).width).toBe(140);
    expect(nodeSizing(8).height).toBe(60);
    expect(nodeSizing(15).width).toBe(140);
  });
  it('returns tier C (120x50) for 16+ nodes', () => {
    expect(nodeSizing(16).width).toBe(120);
    expect(nodeSizing(16).height).toBe(50);
    expect(nodeSizing(64).width).toBe(120);
  });
});

describe('chineseNodeWidth (legalVisuals)', () => {
  const tierA = nodeSizing(5);
  it('returns tier min width (width*1.3) when text is empty or short', () => {
    const minA = Math.ceil(tierA.width * 1.3);
    expect(chineseNodeWidth('', tierA)).toBe(minA);
    expect(chineseNodeWidth('短', tierA)).toBe(minA);
  });
  it('grows linearly with character count for CJK (above tier min width)', () => {
    const fifteenChars = chineseNodeWidth('一二三四五六七八九十一二三四五', tierA);
    expect(fifteenChars).toBe(LEGAL_CJK_WIDTH_PX * 15);
    const twentyChars = chineseNodeWidth('一'.repeat(20), tierA);
    expect(twentyChars).toBe(LEGAL_CJK_WIDTH_PX * 20);
  });
  it('clamps at 350px upper bound', () => {
    const huge = chineseNodeWidth('中'.repeat(50), tierA);
    expect(huge).toBe(LEGAL_NODE_MAX_WIDTH_PX);
  });
  it('counts full-width punctuation at full weight (above tier min width)', () => {
    // 15 个全角标点 = 240px > minA=208，验证全角字符按 1 字符计。
    const fifteen = '，'.repeat(15);
    expect(chineseNodeWidth(fifteen, tierA)).toBe(LEGAL_CJK_WIDTH_PX * 15);
  });
});

describe('edgeStatusStyle (legalVisuals)', () => {
  it('returns confirmed for undefined or unknown status', () => {
    expect(edgeStatusStyle(undefined).status).toBe('confirmed');
    expect(edgeStatusStyle('bogus').status).toBe('confirmed');
  });
  it('maps disputed away from confirmed color', () => {
    expect(edgeStatusStyle('disputed').stroke).not.toBe(edgeStatusStyle('confirmed').stroke);
    expect(EDGE_STATUS_STYLES.disputed.labelPrefix).toBe('争议');
    expect(EDGE_STATUS_STYLES.asserted.labelPrefix).toBe('主张');
    expect(EDGE_STATUS_STYLES.inferred.labelPrefix).toBe('推定');
    expect(EDGE_STATUS_STYLES.missing.labelPrefix).toBe('待补充');
  });
  it('disputed uses dashed stroke, confirmed uses solid', () => {
    expect(EDGE_STATUS_STYLES.disputed.dash.length).toBeGreaterThan(0);
    expect(EDGE_STATUS_STYLES.confirmed.dash.length).toBe(0);
  });
});

describe('legalCanvasOrigin', () => {
  it('is (60, 80) per upstream visual-constants-v1.md', () => {
    expect(LEGAL_CANVAS_ORIGIN).toEqual({ x: 60, y: 80 });
  });
});

describe('legalPaletteCssVars', () => {
  it('emits one CSS variable per palette entry', () => {
    const css = legalPaletteCssVars();
    expect(css).toContain('--legal-primary:');
    expect(css).toContain('--legal-accent-dispute:');
    expect(css).toContain('--legal-grey-missing:');
    expect(css.split('\n').length).toBeGreaterThanOrEqual(12);
  });
});
