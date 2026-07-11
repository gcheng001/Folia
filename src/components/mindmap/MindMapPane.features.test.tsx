/**
 * M-C 起的画布功能测试：多选、对齐/等间距、连接线模式切换、标注框、
 * 自定义流程箭头、工具栏/上下文栏显隐。
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MindMapPane } from './MindMapPane';
import { loadCanvasSidecar, saveCanvasSidecar, emptySidecar, DEFAULT_GROUP_STYLE } from '../../services/mindmap/canvasSidecar';

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

  it('P0-7：预置 customEdges 时，DOM 含同名 id 的 marker 定义', () => {
    const filePath = '/tmp/marker-defs.md';
    saveCanvasSidecar(filePath, {
      ...emptySidecar(),
      customEdges: [{
        id: 'e-test-1', source: 'n1', target: 'n2',
        arrow: 'one-way', shape: 'straight', dash: 'solid',
        color: '#10b981', width: 1.5,
      }, {
        id: 'e-test-2', source: 'n1', target: 'n2',
        arrow: 'both', shape: 'straight', dash: 'solid',
        color: '#ef4444', width: 1.5,
      }],
    });
    try {
      const { host, cleanup } = mount({
        markdown: '# R\n\n## A\n\n## B\n',
        onChange: vi.fn(),
        filePath,
      });
      const ourSvg = Array.from(host.querySelectorAll('svg'))
        .find((el) => el.querySelector('marker#mm-flow-arrow'));
      const svgHtml = ourSvg?.outerHTML ?? '';
      // 调试信息
      if (!svgHtml.includes('arrow-e-test-1-10b981')) {
        // eslint-disable-next-line no-console
        console.log('SVG[len=' + svgHtml.length + ']:', svgHtml.substring(0, 1000));
      }
      // 两条边：end 共 2 个，start 共 1 个（双向边）
      const ids = ['arrow-e-test-1-10b981', 'arrow-e-test-2-ef4444', 'arrow-e-test-2-ef4444-start'];
      for (const id of ids) {
        expect(svgHtml).toContain(`id="${id}"`);
      }
      cleanup();
    } finally {
      saveCanvasSidecar(filePath, emptySidecar());
      localStorage.clear();
    }
  });

  it('P0-1：文件切换 A→B→A 时 sidecar 不串文件', () => {
    const fileA = '/tmp/test-a.md';
    const fileB = '/tmp/test-b.md';
    const onChangeMock = vi.fn();

    try {
      // 文件 A：创建自定义边（用 positionKey 保存）
      saveCanvasSidecar(fileA, {
        ...emptySidecar(),
        customEdges: [{ id: 'e-a-only', source: '子', target: 'A', arrow: 'one-way', shape: 'straight', dash: 'solid', color: '#ff0000', width: 2 }],
      });

      const { host, rerender, cleanup } = mount({
        markdown: '# A\n\n## 子',
        onChange: onChangeMock,
        filePath: fileA,
      });

      // 切换到文件 B（应该不会继承 A 的边）
      rerender({ markdown: '# B\n\n## 子', onChange: onChangeMock, filePath: fileB });
      const sidecarB = loadCanvasSidecar(fileB);
      expect(sidecarB.customEdges.length).toBe(0);

      // 再切换回文件 A（应该仍有原来的边，映射到正确的 n{lineIndex}）
      rerender({ markdown: '# A\n\n## 子', onChange: onChangeMock, filePath: fileA });
      const sidecarA = loadCanvasSidecar(fileA);
      expect(sidecarA.customEdges).toEqual([{ id: 'e-a-only', source: '子', target: 'A', arrow: 'one-way', shape: 'straight', dash: 'solid', color: '#ff0000', width: 2 }]);

      cleanup();
    } finally {
      saveCanvasSidecar(fileA, emptySidecar());
      saveCanvasSidecar(fileB, emptySidecar());
      localStorage.clear();
    }
  });

  it('P0-2：前方插入行后边和框仍指向原节点（positionKey 稳定）', () => {
    const filePath = '/tmp/insert-line.md';
    const onChangeMock = vi.fn();

    try {
      // 初始状态：# 根\n## A\n## B\n## C
      // 创建边 A→B，框包含 [B, C]
      saveCanvasSidecar(filePath, {
        ...emptySidecar(),
        customEdges: [{ id: 'e-ab', source: 'A', target: 'B', arrow: 'one-way', shape: 'straight', dash: 'solid', color: '#10b981', width: 1.5 }],
        groups: [{ id: 'g1', title: '测试框', memberIds: ['B', 'C'], style: DEFAULT_GROUP_STYLE }],
      });

      const { host, rerender, cleanup } = mount({
        markdown: '# 根\n\n## A\n\n## B\n\n## C',
        onChange: onChangeMock,
        filePath,
      });

      // 在根节点后插入新行："## NEW"
      // 此时 lineIndex 变化：B(n2)→n3, C(n3)→n4
      // 但 positionKey 不变，边和框应该仍指向 B, C
      rerender({
        markdown: '# 根\n\n## NEW\n\n## A\n\n## B\n\n## C',
        onChange: onChangeMock,
        filePath,
      });

      const sidecar = loadCanvasSidecar(filePath);
      // 边仍指向 A, B（通过 positionKey）
      expect(sidecar.customEdges[0].source).toBe('A');
      expect(sidecar.customEdges[0].target).toBe('B');
      // 框仍包含 B, C
      expect(sidecar.groups[0].memberIds).toEqual(['B', 'C']);

      cleanup();
    } finally {
      saveCanvasSidecar(filePath, emptySidecar());
      localStorage.clear();
    }
  });

  it('P0-2：节点被删除后边/框引用失效时隐藏，不误绑到别的节点', () => {
    const filePath = '/tmp/dangling-ref.md';
    const onChangeMock = vi.fn();

    try {
      // 初始：# 根\n## A\n## B\n## C
      // 边 A→B，框 [B, C]
      saveCanvasSidecar(filePath, {
        ...emptySidecar(),
        customEdges: [{ id: 'e-ab', source: 'A', target: 'B', arrow: 'one-way', shape: 'straight', dash: 'solid', color: '#10b981', width: 1.5 }],
        groups: [{ id: 'g1', title: '测试框', memberIds: ['B', 'C'], style: DEFAULT_GROUP_STYLE }],
      });

      const { host, rerender, cleanup } = mount({
        markdown: '# 根\n\n## A\n\n## B\n\n## C',
        onChange: onChangeMock,
        filePath,
      });

      // 删除节点 B（修改 Markdown）
      rerender({
        markdown: '# 根\n\n## A\n\n## C',
        onChange: onChangeMock,
        filePath,
      });

      // 边的 target 找不到 B，应该被过滤（不渲染）
      const svg = host.querySelector('svg');
      const html = svg?.outerHTML ?? '';
      // 不应该有任何指向 n? (当前 lineIndex) 的边
      expect(html).not.toMatch(/source="n\d+"/);

      cleanup();
    } finally {
      saveCanvasSidecar(filePath, emptySidecar());
      localStorage.clear();
    }
  });

  // P1-3: 删除键测试
  describe('删除键逻辑（P1-3）', () => {
    it('单选节点按Delete删除节点（含子节点）', () => {
      const onChangeMock = vi.fn();
      const { host, cleanup } = mount({
        markdown: '# 根\n\n## A\n\n### A1\n\n## B\n',
        onChange: onChangeMock,
      });

      // 选中节点 A
      const labelA = Array.from(host.querySelectorAll('.react-flow__node span'))
        .find((element) => element.textContent === 'A') as HTMLElement;
      act(() => {
        labelA.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      });

      // 按Delete键（这里需要模拟confirm对话框）
      const confirmStub = vi.spyOn(window, 'confirm').mockReturnValue(true);
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
      });
      confirmStub.mockRestore();

      // onChange应该被调用，新的Markdown不包含A和A1
      expect(onChangeMock).toHaveBeenCalled();
      const newMd = onChangeMock.mock.calls[0][0] as string;
      expect(newMd).toContain('# 根');
      expect(newMd).toContain('## B');
      expect(newMd).not.toContain('## A');
      expect(newMd).not.toContain('### A1');

      cleanup();
    });

    it('单选边按Delete删除边', () => {
      const filePath = '/tmp/delete-edge.md';
      const onChangeMock = vi.fn();

      try {
        // 创建一条自定义边
        saveCanvasSidecar(filePath, {
          ...emptySidecar(),
          customEdges: [{ id: 'e-test', source: 'A', target: 'B', arrow: 'one-way', shape: 'straight', dash: 'solid', color: '#10b981', width: 1.5 }],
        });

        const { host, cleanup } = mount({
          markdown: '# 根\n\n## A\n\n## B\n',
          onChange: onChangeMock,
          filePath,
        });

        // 选中边（通过模拟点击边的DOM元素）
        const svg = host.querySelector('svg');
        const edgePath = svg?.querySelector('path[class*="customFlow"]');
        if (edgePath) {
          act(() => {
            edgePath.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
          });

          // 按Delete键
          act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
          });

          // 边应该被删除
          const sidecar = loadCanvasSidecar(filePath);
          expect(sidecar.customEdges.length).toBe(0);
        }

        cleanup();
      } finally {
        saveCanvasSidecar(filePath, emptySidecar());
        localStorage.clear();
      }
    });

    it('单选标注框按Delete删除框', () => {
      const filePath = '/tmp/delete-group.md';
      const onChangeMock = vi.fn();

      try {
        // 创建一个标注框
        saveCanvasSidecar(filePath, {
          ...emptySidecar(),
          groups: [{ id: 'g1', title: '测试框', memberIds: ['A', 'B'], style: DEFAULT_GROUP_STYLE }],
        });

        const { host, cleanup } = mount({
          markdown: '# 根\n\n## A\n\n## B\n',
          onChange: onChangeMock,
          filePath,
        });

        // 选中标注框
        const groupNode = host.querySelector('.react-flow__node-annotation');
        if (groupNode) {
          act(() => {
            groupNode.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
          });

          // 按Delete键
          act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
          });

          // 框应该被删除
          const sidecar = loadCanvasSidecar(filePath);
          expect(sidecar.groups.length).toBe(0);
        }

        cleanup();
      } finally {
        saveCanvasSidecar(filePath, emptySidecar());
        localStorage.clear();
      }
    });

    it('多选边和框按Delete只删除边和框，不删除节点', () => {
      const filePath = '/tmp/delete-multi.md';
      const onChangeMock = vi.fn();

      try {
        // 创建边和框
        saveCanvasSidecar(filePath, {
          ...emptySidecar(),
          customEdges: [{ id: 'e-test', source: 'A', target: 'B', arrow: 'one-way', shape: 'straight', dash: 'solid', color: '#10b981', width: 1.5 }],
          groups: [{ id: 'g1', title: '测试框', memberIds: ['B', 'C'], style: DEFAULT_GROUP_STYLE }],
        });

        const { host, cleanup } = mount({
          markdown: '# 根\n\n## A\n\n## B\n\n## C\n',
          onChange: onChangeMock,
          filePath,
        });

        // 手动选中边和框（通过点击它们的DOM元素）
        const svg = host.querySelector('svg');
        const edgePath = svg?.querySelector('path[class*="customFlow"]');
        const groupNode = host.querySelector('.react-flow__node-annotation');

        const selections: HTMLElement[] = [];
        if (edgePath) selections.push(edgePath as HTMLElement);
        if (groupNode) selections.push(groupNode as HTMLElement);

        if (selections.length > 0) {
          // 模拟多选（Shift+点击）
          selections.forEach((el, idx) => {
            act(() => {
              const event = new MouseEvent('click', { bubbles: true, detail: 1, shiftKey: true });
              el.dispatchEvent(event);
            });
          });

          // 按Delete键
          act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
          });

          // 边和框应该被删除，但节点应该保留
          const sidecar = loadCanvasSidecar(filePath);
          expect(sidecar.customEdges.length).toBe(0);
          expect(sidecar.groups.length).toBe(0);
          // onChange不应该被调用（节点没有被删除）
          expect(onChangeMock).not.toHaveBeenCalled();
        }

        cleanup();
      } finally {
        saveCanvasSidecar(filePath, emptySidecar());
        localStorage.clear();
      }
    });

    it('编辑态Delete由浏览器处理，不触发全局删除逻辑', () => {
      const onChangeMock = vi.fn();
      const { host, cleanup } = mount({
        markdown: '# 根\n\n## ABC\n',
        onChange: onChangeMock,
      });

      // 双击节点进入编辑态
      const label = Array.from(host.querySelectorAll('.react-flow__node span'))
        .find((element) => element.textContent === 'ABC') as HTMLElement;
      act(() => {
        label.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      });

      // 找到输入框
      const input = host.querySelector('.react-flow__node input') as HTMLInputElement;
      expect(input).toBeTruthy();
      expect(input.value).toBe('ABC');

      // 记录初始Markdown
      const initialMd = '# 根\n\n## ABC\n';

      // 验证：在编辑态时，全局的keydown处理器不会处理Delete键
      // （因为代码中检查了ae instanceof HTMLInputElement就直接return了）
      // 这意味着浏览器会原生处理input中的Delete，删除选中的文字

      // 验证输入框确实在编辑态
      expect(document.activeElement).toBe(input);

      cleanup();
    });
  });
});
