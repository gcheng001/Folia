/**
 * CustomFlowEdge 单元测试：
 * - straight shape 必须是直线（M sx,sy L tx,ty），不是贝塞尔。
 * - step shape 是折线（getSmoothStepPath 含 H/V 命令）。
 * - 每条边自己的 marker 必须能生成稳定 ID 的 SVG defs。
 * - 双向边同时输出 markerStart + markerEnd，且 start 与 end 是不同 ID。
 * - 颜色正确：end 填 edge.color，不混用 mm-flow-arrow。
 * - none 箭头不出 marker。
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Position, type EdgeProps } from '@xyflow/react';
import { CustomFlowEdge, EdgeMarkerDefs } from './CustomFlowEdge';

function makeEdgeProps(overrides: Partial<EdgeProps> = {}): EdgeProps {
  return {
    id: 'e-cf-1',
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 0,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    style: {},
    source: 'n1',
    target: 'n2',
    ...overrides,
  } as EdgeProps;
}

const STRAIGHT_EDGE = {
  id: 'e-cf-1',
  source: 'n1',
  target: 'n2',
  arrow: 'one-way' as const,
  shape: 'straight' as const,
  dash: 'solid' as const,
  color: '#10b981',
  width: 1.5,
};

describe('CustomFlowEdge', () => {
  it('straight shape 使用真实直线（M .. L ..），不是贝塞尔', () => {
    const html = renderToStaticMarkup(createElement(CustomFlowEdge, {
      ...makeEdgeProps(),
      data: { edge: STRAIGHT_EDGE },
    }));
    // getStraightPath 返回 "M sx,sy L tx,ty"（允许 L 前后 0 或 1 空格）；
    // getBezierPath 含 "C" 曲线命令。
    expect(html).toMatch(/d="M ?0,0 ?L ?100,0"/);
    expect(html).not.toMatch(/[Cc] ?\d/);
  });

  it('step shape 使用折线（getSmoothStepPath 用 Q/拐点）', () => {
    const html = renderToStaticMarkup(createElement(CustomFlowEdge, {
      ...makeEdgeProps({ sourceY: 0, targetY: 40 }),
      data: { edge: { ...STRAIGHT_EDGE, shape: 'step' } },
    }));
    // smooth step path 在水平段用 L 绝对坐标，转折处用 Q 圆角
    // 看到 Q 即说明不是直线也不是贝塞尔
    expect(html).toMatch(/d="[^"]*Q [^"]+"/);
    expect(html).not.toMatch(/d="[^"]* C /);
  });

  it('EdgeMarkerDefs 输出至少一个 marker 定义，id 携带 edgeId+颜色 hash', () => {
    const defs = renderToStaticMarkup(createElement(EdgeMarkerDefs, { edge: STRAIGHT_EDGE, id: 'e-cf-1' }));
    expect(defs).toContain('<marker');
    expect(defs).toContain('fill="#10b981"');
    expect(defs).toContain('<g aria-hidden');
    expect(defs).toContain('data-edge-markers="arrow-e-cf-1-10b981"');
    expect(defs).toMatch(/id="arrow-e-cf-1-10b981"/);
  });

  it('双向边同时定义 end 箭头与 start 箭头（不同 id）', () => {
    const defs = renderToStaticMarkup(createElement(EdgeMarkerDefs, {
      edge: { ...STRAIGHT_EDGE, arrow: 'both' },
      id: 'e-cf-1',
    }));
    expect(defs).toMatch(/id="arrow-e-cf-1-10b981"/);
    expect(defs).toMatch(/id="arrow-e-cf-1-10b981-start"/);
  });

  it('one-way 边 BaseEdge 仅引用 end 箭头', () => {
    const html = renderToStaticMarkup(createElement(CustomFlowEdge, {
      ...makeEdgeProps(),
      data: { edge: STRAIGHT_EDGE },
    }));
    expect(html).toMatch(/marker-end="url\(#arrow-e-cf-1-10b981\)"/);
    expect(html).not.toMatch(/marker-start=/);
  });

  it('none 边不输出 marker', () => {
    const html = renderToStaticMarkup(createElement(CustomFlowEdge, {
      ...makeEdgeProps(),
      data: { edge: { ...STRAIGHT_EDGE, arrow: 'none' } },
    }));
    expect(html).not.toMatch(/marker-end=/);
    expect(html).not.toMatch(/marker-start=/);
  });
});
