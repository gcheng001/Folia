/**
 * 把 React Flow 画布节点导出为 PNG / PDF。
 *
 * 思路：用 react-flow/viewport 算真实包围盒 → 用 html2canvas 截画布 DOM →
 * PNG 直接走 .toBlob('image/png')，PDF 走 html2pdf.js 套壳。隐藏线（edgeMode='none'）
 * 与所选样式（marker/dash/color/group）由调用方先写入到画布，再传过来。
 *
 * PDF 复用 PNG 的裁剪逻辑；导出前会清理 handles、控件、选择框等编辑态 UI。
 */
import type { Node, Edge, ReactFlowInstance } from '@xyflow/react';

export interface ExportBackground {
  /** PNG 背景：'transparent' 或 'white'。PDF 强制 white。 */
  background: 'transparent' | 'white';
}

export interface ExportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExportPoint {
  x: number;
  y: number;
}

export function exportViewportTransform(bounds: Pick<ExportBounds, 'x' | 'y'>): string {
  return `translate(${-bounds.x}px, ${-bounds.y}px) scale(1)`;
}

/** 按所选节点/边/分组/标注框计算真实包围盒（含 8px 余量）。 */
export function computeExportBounds(
  _rf: ReactFlowInstance,
  nodes: Node[],
  edges: Edge[],
  extraPoints: ExportPoint[] = [],
): ExportBounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const w = (n.data as { width?: number })?.width as number | undefined ?? 120;
    const h = (n.data as { height?: number })?.height as number | undefined ?? 40;
    const x = n.position.x;
    const y = n.position.y;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  }
  // 把边端点也算上（用 source/target 节点位置近似）
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  for (const e of edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (s) {
      if (s.position.x < minX) minX = s.position.x;
      if (s.position.y < minY) minY = s.position.y;
    }
    if (t) {
      const w = ((t.data as { width?: number })?.width as number | undefined ?? 120);
      const h = ((t.data as { height?: number })?.height as number | undefined ?? 40);
      if (t.position.x + w > maxX) maxX = t.position.x + w;
      if (t.position.y + h > maxY) maxY = t.position.y + h;
    }
  }
  for (const point of extraPoints) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  if (!Number.isFinite(minX)) {
    // 空画布
    return { x: 0, y: 0, width: 200, height: 100 };
  }
  return {
    x: minX - 16,
    y: minY - 16,
    width: maxX - minX + 32,
    height: maxY - minY + 32,
  };
}

function hasUnsupportedColorSyntax(value: string): boolean {
  return /(?:oklch|oklab|(?<!-)lab|(?<!-)lch|color\(|color-mix\()/i.test(value);
}

function isCanvasSafeColor(value: string): boolean {
  const normalized = value.trim();
  if (!normalized || hasUnsupportedColorSyntax(normalized)) return false;
  return /(?:#[0-9a-f]{3,8}\b|rgba?\(|transparent|currentcolor|none)/i.test(normalized);
}

function fallbackColor(value: string, fallback: string): string {
  return isCanvasSafeColor(value) ? value : fallback;
}

const EXPORT_SAFE_THEME = {
  '--bg': '#faf8f5',
  '--surface': '#ffffff',
  '--border': '#e2dfdb',
  '--fg': '#292524',
  '--text': '#292524',
  '--muted': '#78716c',
  '--accent': '#c2412d',
  '--panel-bg': '#ffffff',
  '--control-bg': '#ffffff',
  '--control-hover-bg': '#f5f5f4',
  '--control-active-bg': 'rgba(194, 65, 45, 0.1)',
  '--border-soft': 'rgba(120, 113, 108, 0.35)',
  '--border-hover': '#a8a29e',
  '--shadow-soft': 'rgba(41, 37, 36, 0.18)',
  '--paper-shadow': 'rgba(41, 37, 36, 0.08)',
} as const;

function safeCssValue(property: string): string {
  if (property in EXPORT_SAFE_THEME) return EXPORT_SAFE_THEME[property as keyof typeof EXPORT_SAFE_THEME];
  if (/shadow/i.test(property)) return 'none';
  if (/background/i.test(property)) return '#ffffff';
  if (/(?:color|fill|stroke|border|outline|caret)/i.test(property)) return '#292524';
  return 'initial';
}

function sanitizeCssRules(rules: CSSRuleList): void {
  for (const rule of Array.from(rules)) {
    const style = 'style' in rule ? (rule as CSSStyleRule).style : undefined;
    if (style) {
      for (const property of Array.from({ length: style.length }, (_, index) => style.item(index))) {
        const value = style.getPropertyValue(property);
        if (!hasUnsupportedColorSyntax(value)) continue;
        const priority = style.getPropertyPriority(property);
        style.removeProperty(property);
        style.setProperty(property, safeCssValue(property), priority);
      }
    }
    const nested = 'cssRules' in rule ? (rule as CSSGroupingRule).cssRules : undefined;
    if (nested) sanitizeCssRules(nested);
  }
}

/** html2canvas 会解析克隆文档的全部样式表；必须在解析前清除 CSS Color 4。 */
export function sanitizeCanvasDocument(documentClone: Document): void {
  for (const sheet of Array.from(documentClone.styleSheets)) {
    try {
      sanitizeCssRules(sheet.cssRules);
    } catch {
      // 无法读取的跨域样式表不能安全交给 html2canvas，禁用它。
      sheet.disabled = true;
    }
  }
  documentClone.querySelectorAll<HTMLElement | SVGElement>('[style]').forEach(stripUnsupportedInlineColors);
}

function applyCanvasSafeTheme(element: HTMLElement): void {
  for (const [property, value] of Object.entries(EXPORT_SAFE_THEME)) {
    element.style.setProperty(property, value);
  }
}

function stripUnsupportedInlineColors(element: HTMLElement | SVGElement): void {
  for (let index = element.style.length - 1; index >= 0; index--) {
    const property = element.style.item(index);
    if (hasUnsupportedColorSyntax(element.style.getPropertyValue(property))) {
      element.style.removeProperty(property);
    }
  }
}

function normalizeCssForExport(source: HTMLElement, clone: HTMLElement): void {
  const sourceElements = [source, ...Array.from(source.querySelectorAll<HTMLElement | SVGElement>('*'))];
  const cloneElements = [clone, ...Array.from(clone.querySelectorAll<HTMLElement | SVGElement>('*'))];
  for (let i = 0; i < cloneElements.length; i++) {
    const sourceEl = sourceElements[i];
    const cloneEl = cloneElements[i];
    if (!sourceEl || !cloneEl) continue;
    const style = window.getComputedStyle(sourceEl);
    stripUnsupportedInlineColors(cloneEl);
    cloneEl.style.color = fallbackColor(style.color, '#111827');
    cloneEl.style.backgroundColor = fallbackColor(style.backgroundColor, 'transparent');
    cloneEl.style.borderColor = fallbackColor(style.borderColor, '#e5e7eb');
    cloneEl.style.caretColor = 'transparent';
    cloneEl.style.outlineColor = fallbackColor(style.outlineColor, 'transparent');
    cloneEl.style.textDecorationColor = fallbackColor(style.textDecorationColor, 'currentcolor');
    if (!isCanvasSafeColor(style.boxShadow)) cloneEl.style.boxShadow = 'none';
    if (!isCanvasSafeColor(style.textShadow)) cloneEl.style.textShadow = 'none';
    if (cloneEl instanceof SVGElement) {
      const stroke = cloneEl.getAttribute('stroke');
      const fill = cloneEl.getAttribute('fill');
      if (stroke && !isCanvasSafeColor(stroke)) cloneEl.setAttribute('stroke', fallbackColor(style.stroke, '#475569'));
      if (fill && !isCanvasSafeColor(fill)) cloneEl.setAttribute('fill', fallbackColor(style.fill, 'none'));
    }
  }
}

function prepareOverflowSvgsForExport(clone: HTMLElement, bounds: ExportBounds): void {
  const freeLineLayer = clone.querySelector<SVGSVGElement>('svg[data-testid="mm-free-flow-layer"]');
  if (!freeLineLayer) return;
  freeLineLayer.setAttribute('width', String(Math.max(1, Math.ceil(bounds.width))));
  freeLineLayer.setAttribute('height', String(Math.max(1, Math.ceil(bounds.height))));
  freeLineLayer.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
  freeLineLayer.style.left = `${bounds.x}px`;
  freeLineLayer.style.top = `${bounds.y}px`;
  freeLineLayer.style.width = `${bounds.width}px`;
  freeLineLayer.style.height = `${bounds.height}px`;
  freeLineLayer.style.overflow = 'visible';
}

/** 克隆画布并隐藏不应出现在导出文件里的编辑态 UI。 */
export function cloneWithUiHidden(element: HTMLElement, bounds?: ExportBounds): { clone: HTMLElement; cleanup: () => void } {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.dataset.foliaExportRoot = 'true';
  applyCanvasSafeTheme(clone);

  // 隐藏不需要导出的 UI 元素。
  const hideSelectors = [
    '.react-flow__handle', // 连接点
    '.react-flow__controls', // 缩放控制按钮
    '.react-flow__attribution', // React Flow logo
    '.react-flow__selection', // 选择框
    '.selection-rect', // 框选矩形
    '.mindmap-selection-ring', // 选中边光晕
    '.react-flow__background', // 编辑网格背景
    '.react-flow__minimap',
    '.react-flow__panel',
    '[role="toolbar"]',
    '[data-testid="mm-context-bar"]',
  ];

  hideSelectors.forEach((selector) => {
    const elements = clone.querySelectorAll(selector);
    elements.forEach((el) => {
      (el as HTMLElement).style.display = 'none';
    });
  });

  // 处理节点选中轮廓。
  const selectedNodes = clone.querySelectorAll('.react-flow__node.selected');
  selectedNodes.forEach((node) => {
    node.classList.remove('selected');
    (node as HTMLElement).style.outline = 'none';
  });
  const selectedMindMapNodes = clone.querySelectorAll('[data-mindmap-selected="true"]');
  selectedMindMapNodes.forEach((node) => {
    const el = node as HTMLElement;
    el.removeAttribute('data-mindmap-selected');
    el.style.boxShadow = 'none';
    el.style.outline = 'none';
  });

  // 处理编辑 input，替换为显示文字。
  const inputs = clone.querySelectorAll('input');
  inputs.forEach((input) => {
    const value = (input as HTMLInputElement).value;
    const span = document.createElement('span');
    span.textContent = value;
    input.replaceWith(span);
  });

  const viewport = (clone.matches('.react-flow__viewport') ? clone : clone.querySelector('.react-flow__viewport')) as HTMLElement | null;
  if (viewport && bounds) viewport.style.transform = exportViewportTransform(bounds);
  if (bounds) prepareOverflowSvgsForExport(clone, bounds);
  normalizeCssForExport(element, clone);
  if (bounds) {
    clone.style.width = `${bounds.width}px`;
    clone.style.height = `${bounds.height}px`;
    clone.style.overflow = 'hidden';
    clone.style.position = 'fixed';
    clone.style.left = '0';
    clone.style.top = '0';
    clone.style.zIndex = '-1';
  }

  const cleanup = () => {
    // 清理 clone 节点，释放内存。
    clone.remove();
  };

  return { clone, cleanup };
}

/** 把画布 DOM 渲染成 PNG（DataURL）。scale=像素倍率，2/4 倍高清。 */
export async function snapshotToPng(
  _rf: ReactFlowInstance,
  element: HTMLElement,
  bounds: ExportBounds,
  options: { background: 'transparent' | 'white'; scale?: number } = { background: 'white' },
): Promise<Blob> {
  const scale = options.scale ?? 2;
  const { default: html2canvas } = await import('html2canvas');

  const { clone, cleanup } = cloneWithUiHidden(element, bounds);
  document.body.appendChild(clone);

  try {
    // clone 已把 flow 坐标原点移动到裁剪区域左上角，截图从 clone 的 0,0 开始。
    const canvas = await html2canvas(clone, {
      backgroundColor: options.background === 'white' ? '#ffffff' : null,
      scale,
      useCORS: true,
      logging: false,
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height,
      windowWidth: bounds.width,
      windowHeight: bounds.height,
      onclone: (clonedDoc) => {
        sanitizeCanvasDocument(clonedDoc);
        const exportRoot = clonedDoc.querySelector<HTMLElement>('[data-folia-export-root="true"]');
        if (exportRoot) applyCanvasSafeTheme(exportRoot);
        const clonedViewport = exportRoot?.querySelector('.react-flow__viewport') as HTMLElement | null;
        if (clonedViewport) {
          clonedViewport.style.transform = exportViewportTransform(bounds);
        }
      },
    });

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob 失败'))), 'image/png');
    });
  } finally {
    cleanup();
  }
}

/** 用 html2pdf.js 把画布 DOM 渲染成 PDF Blob（强制白底），复用 PNG 裁剪逻辑。 */
export async function snapshotToPdf(
  rf: ReactFlowInstance,
  element: HTMLElement,
  bounds: ExportBounds,
  suggestedName: string,
): Promise<Blob> {
  const png = await snapshotToPng(rf, element, bounds, { background: 'white', scale: 2 });
  const url = URL.createObjectURL(png);
  try {
    const mod = await import('html2pdf.js');
    const html2pdf = mod.default;
    const image = document.createElement('img');
    image.width = Math.max(1, Math.round(bounds.width));
    image.height = Math.max(1, Math.round(bounds.height));
    image.style.display = 'block';
    image.style.width = '100%';
    image.style.height = 'auto';
    const imageLoaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('PDF 图片加载失败'));
    });
    image.src = url;
    await imageLoaded;
    const pdfWidth = Math.max(1, Math.round(bounds.width));
    const pdfHeight = Math.max(1, Math.round(bounds.height));
    return await html2pdf()
        .set({
          margin: 0,
          filename: suggestedName,
          image: { type: 'png', quality: 1 },
          html2canvas: { backgroundColor: '#ffffff', scale: 1, useCORS: true, logging: false },
          jsPDF: {
            unit: 'pt',
            format: [pdfWidth, pdfHeight],
            orientation: pdfWidth >= pdfHeight ? 'landscape' : 'portrait',
          },
        })
        .from(image)
        .outputPdf('blob') as Blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
