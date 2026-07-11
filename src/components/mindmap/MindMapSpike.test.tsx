/**
 * M-B Spike 测试：React Flow v12 能否在 React 19 + 本项目 vitest/jsdom 下实挂载。
 *
 * 用 react-dom/client createRoot + act 做真实挂载（非 SSR），这是 React 19
 * 协调器 + effects 与 React Flow 交互的暴露点——SSR 渲染测不出真兼容性。
 *
 * ResizeObserver / DOMMatrix 是 jsdom 已知缺口，非 React 19 兼容问题，stub 掉
 * 避免假阴性；真实 Tauri WebView 原生具备这些 API。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MindMapSpike } from './MindMapSpike';

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

describe('M-B Spike: React Flow × React 19', () => {
  it('React 19 下挂载 React Flow 不抛错，根容器与节点文本均渲染', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    let thrown: unknown = null;
    try {
      act(() => {
        root.render(createElement(MindMapSpike));
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeNull();
    expect(host.querySelector('.react-flow')).toBeTruthy();
    expect(host.textContent).toContain('庭审记录');
    expect(host.textContent).toContain('二、诉讼请求');

    act(() => {
      root.unmount();
    });
    host.remove();
  });
});
