import { describe, expect, it } from 'vitest';
import { cloneWithUiHidden, computeExportBounds, exportViewportTransform, sanitizeCanvasDocument } from './exportImage';

describe('exportImage', () => {
  it('导出 bounds 会包含额外流程线端点', () => {
    const bounds = computeExportBounds(
      {} as never,
      [{
        id: 'n1',
        position: { x: 0, y: 0 },
        data: { width: 100, height: 40 },
      } as never],
      [],
      [{ x: 420, y: 160 }],
    );

    expect(bounds.x).toBe(-16);
    expect(bounds.y).toBe(-16);
    expect(bounds.width).toBe(452);
    expect(bounds.height).toBe(192);
    expect(exportViewportTransform(bounds)).toBe('translate(16px, 16px) scale(1)');
    expect(exportViewportTransform(bounds)).not.toContain('--16px');
  });

  it('克隆导出 DOM 时移除编辑态 UI 和选择态', () => {
    const element = document.createElement('div');
    element.className = 'react-flow';
    element.innerHTML = `
      <div class="react-flow__viewport">
        <div class="react-flow__handle"></div>
        <svg data-testid="mm-free-flow-layer" style="position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;">
          <path d="M 10 20 L 420 160" stroke="#475569" fill="none"></path>
        </svg>
        <svg><path class="mindmap-selection-ring" d="M0 0 L10 10"></path></svg>
        <div class="react-flow__node selected">
          <div data-mindmap-node="true" data-mindmap-selected="true" style="box-shadow: 0 0 0 5px #2563eb; outline: 2px solid #2563eb;">
            <input value="节点文字" />
          </div>
        </div>
        <div class="modern-color" style="color:oklch(20% 0.02 60);background:oklch(97% 0.012 80);box-shadow:0 1px 2px oklch(20% 0.02 60 / 0.18)">颜色兼容</div>
        <svg><path class="modern-svg-color" fill="oklch(58% 0.16 35)" stroke="oklch(20% 0.02 60)"></path></svg>
      </div>
    `;
    document.body.appendChild(element);

    const { clone, cleanup } = cloneWithUiHidden(element, { x: 10, y: 20, width: 300, height: 200 });

    try {
      expect((clone.querySelector('.react-flow__handle') as HTMLElement).style.display).toBe('none');
      expect((clone.querySelector('.mindmap-selection-ring') as HTMLElement).style.display).toBe('none');
      const selected = clone.querySelector('[data-mindmap-node="true"]') as HTMLElement;
      expect(selected.getAttribute('data-mindmap-selected')).toBeNull();
      expect(selected.style.boxShadow).toBe('none');
      expect(selected.style.outline).toBe('none');
      expect(clone.querySelector('input')).toBeNull();
      expect(clone.textContent).toContain('节点文字');
      const freeLayer = clone.querySelector('svg[data-testid="mm-free-flow-layer"]') as SVGSVGElement;
      expect(freeLayer.getAttribute('viewBox')).toBe('10 20 300 200');
      expect(freeLayer.style.left).toBe('10px');
      expect(freeLayer.style.width).toBe('300px');
      expect(clone.style.width).toBe('300px');
      expect(clone.style.height).toBe('200px');
      expect(clone.dataset.foliaExportRoot).toBe('true');
      expect(clone.style.getPropertyValue('--bg')).toBe('#faf8f5');
      expect(clone.style.getPropertyValue('--surface')).toBe('#ffffff');
      expect(clone.outerHTML).not.toMatch(/oklch\(/i);
    } finally {
      cleanup();
      element.remove();
    }
  });

  it('在 html2canvas 解析前递归清理全局 CSS Color 4 声明', () => {
    const documentClone = document.implementation.createHTMLDocument('export');
    const style = documentClone.createElement('style');
    style.textContent = `
      :root { --bg: oklch(97% 0.012 80); }
      .node { color: oklch(20% 0.02 60); background: color-mix(in oklch, red 20%, white); }
      @media (min-width: 1px) { .edge { stroke: oklch(58% 0.16 35); } }
    `;
    documentClone.head.appendChild(style);

    sanitizeCanvasDocument(documentClone);

    const css = Array.from(documentClone.styleSheets)
      .flatMap((sheet) => Array.from(sheet.cssRules).map((rule) => rule.cssText))
      .join('\n');
    expect(css).not.toMatch(/oklch|color-mix/i);
  });
});
