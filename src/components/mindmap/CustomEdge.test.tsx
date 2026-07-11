import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Position, type EdgeProps } from '@xyflow/react';
import { CustomEdge } from './CustomEdge';

describe('CustomEdge', () => {
  it('使用单段直线路径，不含曲线或折线命令', () => {
    const props = {
      id: 'e1',
      sourceX: 0,
      sourceY: 10,
      targetX: 100,
      targetY: 50,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: {},
    } as EdgeProps;
    const html = renderToStaticMarkup(createElement(CustomEdge, props));

    expect(html).toContain('d="M 0,10L 100,50"');
    expect(html).not.toMatch(/d="[^"]*[CQSAHV]/);
  });
});
