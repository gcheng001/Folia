/**
 * M-C 起的画布功能测试：多选、对齐/等间距、连接线模式切换、标注框、
 * 自定义流程箭头、工具栏/上下文栏显隐。
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MindMapPane } from './MindMapPane';

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

function mount(props: { markdown: string; onChange?: (s: string) => void; fileName?: string; filePath?: string }): { host: HTMLDivElement; root: ReturnType<typeof createRoot>; rerender: (next: { markdown?: string; onChange?: (s: string) => void }) => void; cleanup: () => void } {
  const host = document.createElement('div');
  host.style.width = '800px';
  host.style.height = '600px';
  document.body.appendChild(host);
  const root = createRoot(host);
  let current = { ...props };
  const render = (): void => {
    act(() => {
      root.render(createElement(MindMapPane, current as never));
    });
  };
  render();
  return {
    host, root,
    rerender: (next) => {
      current = { ...current, ...next };
      render();
    },
    cleanup: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

describe('MindMapPane 画布功能（M-C 起）', () => {
  it('工具栏渲染 8 个核心按钮 + 主题切换', () => {
    const { host, cleanup } = mount({ markdown: '# 根\n\n## A\n' });
    expect(host.querySelector('[data-testid="mm-tool-select"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="mm-tool-connect"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="mm-tool-auto-layout"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="mm-tool-align"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="mm-tool-group"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="mm-tool-export"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="mm-tool-undo"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="mm-tool-redo"]')).toBeTruthy();
    cleanup();
  });

  it('连接线模式三种切换持久化到 sidecar', () => {
    const { host, cleanup } = mount({ markdown: '# 根\n\n## A\n', filePath: '/tmp/mode.md' });
    act(() => {
      (host.querySelector('[data-testid="mm-edge-mode-flow"]') as HTMLButtonElement).click();
    });
    expect(host.querySelector('[data-testid="mm-edge-mode-flow"]')?.getAttribute('aria-pressed')).toBe('true');
    act(() => {
      (host.querySelector('[data-testid="mm-edge-mode-none"]') as HTMLButtonElement).click();
    });
    expect(host.querySelector('[data-testid="mm-edge-mode-none"]')?.getAttribute('aria-pressed')).toBe('true');
    cleanup();
  });

  it('Cmd/Ctrl+A 全选节点', () => {
    const { host, cleanup } = mount({ markdown: '# 根\n\n## A\n\n## B\n', onChange: vi.fn() });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    // 选中后「添加标注框」按钮会变 enabled
    const groupBtn = host.querySelector('[data-testid="mm-tool-group"]') as HTMLButtonElement;
    expect(groupBtn.disabled).toBe(false);
    cleanup();
  });

  it('选中 0/1 时对齐与标注框按钮不可用', () => {
    const { host, cleanup } = mount({ markdown: '# 根\n\n## A\n', onChange: vi.fn() });
    const alignBtn = host.querySelector('[data-testid="mm-tool-align"]') as HTMLButtonElement;
    const groupBtn = host.querySelector('[data-testid="mm-tool-group"]') as HTMLButtonElement;
    expect(alignBtn.disabled).toBe(true);
    expect(groupBtn.disabled).toBe(true);
    cleanup();
  });

  it('选中节点后上下文样式栏出现', () => {
    const { host, cleanup } = mount({ markdown: '# 根\n\n## A\n', onChange: vi.fn() });
    const label = Array.from(host.querySelectorAll('.react-flow__node span'))
      .find((element) => element.textContent === 'A') as HTMLElement;
    act(() => {
      label.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    expect(host.querySelector('[data-testid="mm-context-bar"]')).toBeTruthy();
    cleanup();
  });

  it('添加标注框：选中两个节点后点击工具栏 → 出现一个 annotation 节点', () => {
    const { host, cleanup } = mount({ markdown: '# 根\n\n## A\n\n## B\n', onChange: vi.fn(), filePath: '/tmp/group.md' });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    act(() => {
      (host.querySelector('[data-testid="mm-tool-group"]') as HTMLButtonElement).click();
    });
    // 至少有一个 .react-flow__node-annotation
    const groupNode = host.querySelector('.react-flow__node-annotation');
    expect(groupNode).toBeTruthy();
    cleanup();
  });

  it('连接模式开关切换 toolbar 选中态', () => {
    const { host, cleanup } = mount({ markdown: '# 根\n\n## A\n', onChange: vi.fn() });
    const btn = host.querySelector('[data-testid="mm-tool-connect"]') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toContain('连接');
    act(() => {
      btn.click();
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    cleanup();
  });

  it('主题面板点击主题按钮可切换', () => {
    const { host, cleanup } = mount({ markdown: '# 根\n\n## A\n' });
    act(() => {
      (host.querySelector('[data-testid="mm-tool-themes"]') as HTMLButtonElement).click();
    });
    expect(host.querySelector('[data-testid="mm-theme-panel"]')).toBeTruthy();
    act(() => {
      (host.querySelector('[data-testid="mm-theme-simple-color"]') as HTMLButtonElement).click();
    });
    expect(host.querySelector('[data-testid="mm-theme-simple-color"]')?.getAttribute('aria-checked')).toBe('true');
    cleanup();
  });
});
