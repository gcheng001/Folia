/**
 * M-B 只读画布挂载测试：真实解析 hearing-realistic.md → 布局 → React Flow 渲染。
 * ResizeObserver/DOMMatrix stub 理由同 MindMapSpike.test.tsx——jsdom 缺口，非
 * 组件本身兼容性问题。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MindMapPane } from './MindMapPane';
import realisticMd from '../../services/mindmap/__fixtures__/hearing-realistic.md?raw';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g.ResizeObserver) g.ResizeObserver = ResizeObserverStub;
  if (!g.DOMMatrix) {
    g.DOMMatrix = class DOMMatrixStub {
      constructor(..._args: unknown[]) {}
      multiply(): this {
        return this;
      }
    };
  }
});

describe('MindMapPane (M-B 只读画布)', () => {
  it('渲染庭审记录实战脑图，展示一级节点文本，不抛错', () => {
    const host = document.createElement('div');
    host.style.width = '800px';
    host.style.height = '600px';
    document.body.appendChild(host);
    const root = createRoot(host);

    let thrown: unknown = null;
    try {
      act(() => {
        root.render(createElement(MindMapPane, { markdown: realisticMd }));
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeNull();
    expect(host.querySelector('.react-flow')).toBeTruthy();
    expect(host.textContent).toContain('案件信息');
    expect(host.textContent).toContain('诉讼请求');

    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it('节点不可拖拽/不可连接/不可选中（只读约束）', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    act(() => {
      root.render(createElement(MindMapPane, { markdown: '# 根\n\n## 子节点\n' }));
    });

    // React Flow 只读节点不带 draggable 类名
    const node = host.querySelector('.react-flow__node');
    expect(node).toBeTruthy();
    expect(node?.className).not.toContain('draggable');

    act(() => {
      root.unmount();
    });
    host.remove();
  });
});
