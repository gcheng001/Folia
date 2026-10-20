import { describe, expect, it } from 'vitest';
import { classifyDirection, resolveEndpoint, snapEndpoint, snapLineEnd, tidyFreeLines } from './freeFlow';
import type { FreeFlowLine } from './canvasSidecar';

const nodes = [
  { id: 'n1', x: 100, y: 100, width: 120, height: 60 },
  { id: 'n2', x: 360, y: 100, width: 120, height: 60 },
];

describe('freeFlow', () => {
  it('按角度分类方向', () => {
    expect(classifyDirection({ x: 0, y: 0 }, { x: 100, y: 8 })).toBe('horizontal');
    expect(classifyDirection({ x: 0, y: 0 }, { x: 8, y: 100 })).toBe('vertical');
    expect(classifyDirection({ x: 0, y: 0 }, { x: 100, y: 100 })).toBe('diag-down');
    expect(classifyDirection({ x: 0, y: 100 }, { x: 100, y: 0 })).toBe('diag-up');
  });

  it('靠近节点时默认绑定，Alt 模式只吸附坐标不绑定', () => {
    const bound = snapEndpoint({ x: 221, y: 130 }, nodes, { bindToNode: true });
    expect(bound).toEqual({ kind: 'bound', nodeId: 'n1', anchor: 'right', x: 220, y: 130 });

    const free = snapEndpoint({ x: 221, y: 130 }, nodes, { bindToNode: false });
    expect(free).toEqual({ kind: 'free', x: 220, y: 130 });
  });

  it('Shift 角度吸附能把尾端拉成水平线', () => {
    const endpoint = snapLineEnd({ x: 0, y: 0 }, { x: 100, y: 12 }, [], {
      bindToNode: true,
      angleSnap: true,
    });
    expect(endpoint).toEqual({ kind: 'free', x: 100, y: 0 });
  });

  it('规整自由线时统一多数方向、长度和箭头样式', () => {
    const lines: FreeFlowLine[] = [
      { id: 'fl-1', start: { kind: 'free', x: 0, y: 0 }, end: { kind: 'free', x: 100, y: 5 }, arrow: 'one-way', shape: 'straight', dash: 'solid', color: '#475569', width: 1.8 },
      { id: 'fl-2', start: { kind: 'free', x: 0, y: 40 }, end: { kind: 'free', x: 140, y: 30 }, arrow: 'one-way', shape: 'straight', dash: 'solid', color: '#475569', width: 1.8 },
      { id: 'fl-3', start: { kind: 'free', x: 0, y: 80 }, end: { kind: 'free', x: 80, y: 80 }, arrow: 'none', shape: 'straight', dash: 'solid', color: '#475569', width: 1.8 },
    ];

    const tidied = tidyFreeLines(lines, []);
    expect(tidied.every((line) => line.arrow === 'one-way')).toBe(true);
    expect(tidied.every((line) => classifyDirection(resolveEndpoint(line.start, []), resolveEndpoint(line.end, [])) === 'horizontal')).toBe(true);
    const lengths = tidied.map((line) => {
      const start = resolveEndpoint(line.start, []);
      const end = resolveEndpoint(line.end, []);
      return Math.round(Math.hypot(end.x - start.x, end.y - start.y));
    });
    expect(new Set(lengths).size).toBe(1);
  });
});
