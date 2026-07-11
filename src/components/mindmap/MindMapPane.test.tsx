/**
 * M-B 只读画布挂载测试：真实解析 hearing-realistic.md → 布局 → React Flow 渲染。
 * ResizeObserver/DOMMatrix stub 理由同 MindMapSpike.test.tsx——jsdom 缺口，非
 * 组件本身兼容性问题。
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
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

  it('双击节点文字后可直接增删文字，并将结果回写 Markdown', () => {
    const host = document.createElement('div');
    host.style.width = '800px';
    host.style.height = '600px';
    document.body.appendChild(host);
    const root = createRoot(host);
    const onChange = vi.fn();

    act(() => {
      root.render(createElement(MindMapPane, {
        markdown: '# 根\n\n## 原文字\n',
        onChange,
      }));
    });

    const label = Array.from(host.querySelectorAll('.react-flow__node span'))
      .find((element) => element.textContent === '原文字');
    expect(label).toBeTruthy();

    act(() => {
      label?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });

    const input = host.querySelector<HTMLInputElement>('input[aria-label="编辑节点文字"]');
    expect(input).toBeTruthy();
    expect(input?.classList.contains('nodrag')).toBe(true);

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(input, '修改后增加文字');
      input?.dispatchEvent(new InputEvent('input', { bubbles: true }));
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });

    expect(onChange).toHaveBeenLastCalledWith('# 根\n\n## 修改后增加文字\n');

    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it('双击文件名虚拟根也能编辑，并在 Markdown 顶部落成真实 H1', () => {
    const host = document.createElement('div');
    host.style.width = '800px';
    host.style.height = '600px';
    document.body.appendChild(host);
    const root = createRoot(host);
    const onChange = vi.fn();

    act(() => {
      root.render(createElement(MindMapPane, {
        markdown: '开篇正文。\n\n## 第一部分\n',
        fileName: '案件报告.md',
        onChange,
      }));
    });

    const rootLabel = Array.from(host.querySelectorAll('.react-flow__node span'))
      .find((element) => element.textContent === '案件报告.md');
    expect(rootLabel).toBeTruthy();

    act(() => {
      rootLabel?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });

    const input = host.querySelector<HTMLInputElement>('input[aria-label="编辑节点文字"]');
    expect(input).toBeTruthy();

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(input, '案件分析报告');
      input?.dispatchEvent(new InputEvent('input', { bubbles: true }));
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });

    expect(onChange).toHaveBeenLastCalledWith('# 案件分析报告\n\n开篇正文。\n\n## 第一部分\n');

    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it('WKWebView 仅送达第二次 click(detail=2) 时也进入编辑', () => {
    const host = document.createElement('div');
    host.style.width = '800px';
    host.style.height = '600px';
    document.body.appendChild(host);
    const root = createRoot(host);

    act(() => {
      root.render(createElement(MindMapPane, {
        markdown: '# 根\n\n## 子节点\n',
        onChange: vi.fn(),
      }));
    });

    const label = Array.from(host.querySelectorAll('.react-flow__node span'))
      .find((element) => element.textContent === '子节点');
    expect(label).toBeTruthy();

    act(() => {
      label?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      label?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    });

    expect(host.querySelector('input[aria-label="编辑节点文字"]')).toBeTruthy();
    expect(document.activeElement).toBe(host.querySelector('input[aria-label="编辑节点文字"]'));

    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it('单击选中节点后按空格立即进入编辑，即使画布容器没有焦点', () => {
    const host = document.createElement('div');
    host.style.width = '800px';
    host.style.height = '600px';
    document.body.appendChild(host);
    const root = createRoot(host);

    act(() => {
      root.render(createElement(MindMapPane, {
        markdown: '# 根\n\n## 子节点\n',
        onChange: vi.fn(),
      }));
    });

    const label = Array.from(host.querySelectorAll('.react-flow__node span'))
      .find((element) => element.textContent === '子节点');
    act(() => {
      label?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
    });

    expect(host.querySelector('input[aria-label="编辑节点文字"]')).toBeTruthy();
    expect(document.activeElement).toBe(host.querySelector('input[aria-label="编辑节点文字"]'));

    act(() => root.unmount());
    host.remove();
  });

  it('连续两次普通 click 同一节点时第二下直接进入编辑', () => {
    const host = document.createElement('div');
    host.style.width = '800px';
    host.style.height = '600px';
    document.body.appendChild(host);
    const root = createRoot(host);

    act(() => {
      root.render(createElement(MindMapPane, {
        markdown: '# 根\n\n## 子节点\n',
        onChange: vi.fn(),
      }));
    });

    const label = Array.from(host.querySelectorAll('.react-flow__node span'))
      .find((element) => element.textContent === '子节点');
    act(() => {
      label?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    act(() => {
      label?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });

    expect(host.querySelector('input[aria-label="编辑节点文字"]')).toBeTruthy();
    expect(document.activeElement).toBe(host.querySelector('input[aria-label="编辑节点文字"]'));

    act(() => root.unmount());
    host.remove();
  });

  it('根节点按 Enter 新建子节点，普通节点按 Tab 新建下级并进入编辑', () => {
    const host = document.createElement('div');
    host.style.width = '800px';
    host.style.height = '600px';
    document.body.appendChild(host);
    const root = createRoot(host);
    let markdown = '# 根\n\n## 已有节点\n';

    const render = (): void => {
      root.render(createElement(MindMapPane, {
        markdown,
        onChange: (next: string) => {
          markdown = next;
          render();
        },
      }));
    };
    act(render);

    const rootLabel = Array.from(host.querySelectorAll('.react-flow__node span'))
      .find((element) => element.textContent === '根');
    act(() => {
      rootLabel?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(markdown).toMatch(/^## $/m);
    expect(host.querySelector('input[aria-label="编辑节点文字"]')).toBeTruthy();

    act(() => {
      host.querySelector<HTMLInputElement>('input[aria-label="编辑节点文字"]')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });

    const existingLabel = Array.from(host.querySelectorAll('.react-flow__node span'))
      .find((element) => element.textContent === '已有节点');
    act(() => {
      existingLabel?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    expect(markdown).toContain('### ');
    expect(host.querySelector('input[aria-label="编辑节点文字"]')).toBeTruthy();

    act(() => root.unmount());
    host.remove();
  });

  it('所有节点均使用小圆角完整长方框，不再使用胶囊或仅下划线样式', () => {
    const host = document.createElement('div');
    host.style.width = '800px';
    host.style.height = '600px';
    document.body.appendChild(host);
    const root = createRoot(host);

    act(() => {
      root.render(createElement(MindMapPane, { markdown: '# 根\n\n## 子节点\n' }));
    });

    for (const label of ['根', '子节点']) {
      const text = Array.from(host.querySelectorAll('.react-flow__node span'))
        .find((element) => element.textContent === label);
      const box = text?.parentElement;
      expect(box?.style.borderRadius).toBe('2px');
      expect(box?.style.borderStyle).toBe('solid');
      expect(box?.style.borderBottomStyle).toBe('solid');
      expect(box?.style.borderTopStyle).toBe('solid');
    }

    act(() => root.unmount());
    host.remove();
  });
});
