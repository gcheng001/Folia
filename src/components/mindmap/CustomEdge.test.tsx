import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Position, type EdgeProps } from '@xyflow/react';
import { CustomEdge } from './CustomEdge';

describe('CustomEdge', () => {
  const props = {
      id: 'e1',
      sourceX: 0,
      sourceY: 50,
      targetX: 100,
      targetY: 10,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: {},
    } as EdgeProps;

  it('经典树使用共享干线式圆角直角支路', () => {
    const html = renderToStaticMarkup(createElement(CustomEdge, {
      ...props,
      data: { edgeVariant: 'classic-branch' },
    }));

    expect(html).toContain('d="M 0,50H 44V 22Q 44,10 56,10H 100"');
    expect(html).toContain('stroke-linecap="round"');
  });

  it('原有主题继续使用单段直线路径', () => {
    const html = renderToStaticMarkup(createElement(CustomEdge, props));

    expect(html).toContain('d="M 0,50L 100,10"');
    expect(html).not.toMatch(/d="[^"]*[CQSAHV]/);
  });
});
