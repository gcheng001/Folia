// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { alignNodes, distributeNodes, type NodeBox } from './align';

const box = (id: string, x: number, y: number, w: number, h: number): NodeBox => ({
  id, x, y, width: w, height: h,
});

describe('alignNodes（选中节点的对齐）', () => {
  const boxes: NodeBox[] = [
    box('a', 100, 50, 60, 40),
    box('b', 200, 30, 80, 60),
    box('c', 300, 70, 50, 30),
  ];

  it('少于 2 个节点直接返回空', () => {
    expect(alignNodes([boxes[0]], 'left')).toEqual([]);
  });

  it('左对齐：以最左为基准，y 不变', () => {
    const r = alignNodes(boxes, 'left');
    expect(r.map((p) => p.x)).toEqual([100, 100, 100]);
    expect(r.map((p) => p.y)).toEqual([50, 30, 70]);
  });

  it('右对齐：以最右为基准（right - width）', () => {
    const r = alignNodes(boxes, 'right');
    // 最右 = 300 + 50 = 350
    expect(r[0].x).toBe(350 - 60);
    expect(r[1].x).toBe(350 - 80);
    expect(r[2].x).toBe(350 - 50);
  });

  it('水平居中：x 各自减去 halfWidth 偏移到组中心', () => {
    const r = alignNodes(boxes, 'center-h');
    // 组中心 cx = (100 + 350) / 2 = 225
    expect(r[0].x).toBe(225 - 30);
    expect(r[1].x).toBe(225 - 40);
    expect(r[2].x).toBe(225 - 25);
  });

  it('顶部对齐：y 统一为最上', () => {
    const r = alignNodes(boxes, 'top');
    expect(r.map((p) => p.y)).toEqual([30, 30, 30]);
  });

  it('垂直居中：y 各自减去 halfHeight 偏移到组中心', () => {
    const r = alignNodes(boxes, 'center-v');
    // 组顶 30、组底 100，组中心 cy = 65
    expect(r[0].y).toBe(65 - 20);
    expect(r[1].y).toBe(65 - 30);
    expect(r[2].y).toBe(65 - 15);
  });

  it('底部对齐：y 统一为组底 - height', () => {
    const r = alignNodes(boxes, 'bottom');
    // 组底 100
    expect(r[0].y).toBe(100 - 40);
    expect(r[1].y).toBe(100 - 60);
    expect(r[2].y).toBe(100 - 30);
  });
});

describe('distributeNodes（选中节点的等间距）', () => {
  it('少于 3 个节点直接返回空', () => {
    const boxes = [box('a', 0, 0, 10, 10), box('b', 100, 0, 10, 10)];
    expect(distributeNodes(boxes, 'horizontal')).toEqual([]);
  });

  it('水平等间距：两端不动，中间按间距均分', () => {
    const boxes = [
      box('a', 0, 0, 20, 10),   // cx=10
      box('b', 100, 0, 20, 10), // cx=110
      box('c', 200, 0, 20, 10), // cx=210
    ];
    const r = distributeNodes(boxes, 'horizontal');
    // 步长 100；新 cx: 10, 110, 210
    expect(r[0]).toEqual({ x: 0, y: 0 });
    expect(r[2]).toEqual({ x: 200, y: 0 });
    expect(r[1]).toEqual({ x: 100, y: 0 });
  });

  it('垂直等间距：两端不动，中间按间距均分', () => {
    const boxes = [
      box('a', 0, 0, 10, 20),   // cy=10
      box('b', 0, 100, 10, 20), // cy=110
      box('c', 0, 200, 10, 20), // cy=210
    ];
    const r = distributeNodes(boxes, 'vertical');
    expect(r[0]).toEqual({ x: 0, y: 0 });
    expect(r[2]).toEqual({ x: 0, y: 200 });
    expect(r[1]).toEqual({ x: 0, y: 100 });
  });
});
