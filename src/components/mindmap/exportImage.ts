/**
 * 把 React Flow 画布节点导出为 PNG / PDF。
 *
 * 思路：用 react-flow/viewport 算真实包围盒 → 用 html2canvas 截画布 DOM →
 * PNG 直接走 .toBlob('image/png')，PDF 走 html2pdf.js 套壳。隐藏线（edgeMode='none'）
 * 与所选样式（marker/dash/color/group）由调用方先写入到画布，再传过来。
 *
 * 不导出任何 UI 元素：选择框/连接点/工具栏/编辑输入框都不在画布 DOM
 * 主节点下，不被截到。
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

/** 按所选节点/边/分组/标注框计算真实包围盒（含 8px 余量）。 */
export function computeExportBounds(
  _rf: ReactFlowInstance,
  nodes: Node[],
  edges: Edge[],
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

/** 把画布 DOM 渲染成 PNG（DataURL）。scale=像素倍率，2/4 倍高清。 */
export async function snapshotToPng(
  rf: ReactFlowInstance,
  element: HTMLElement,
  bounds: ExportBounds,
  options: { background: 'transparent' | 'white'; scale?: number } = { background: 'white' },
): Promise<Blob> {
  const scale = options.scale ?? 2;
  const { default: html2canvas } = await import('html2canvas');
  const canvas = await html2canvas(element, {
    backgroundColor: options.background === 'white' ? '#ffffff' : null,
    scale,
    useCORS: true,
    logging: false,
    x: bounds.x * rf.getViewport().zoom + rf.getViewport().x,
    y: bounds.y * rf.getViewport().zoom + rf.getViewport().y,
    width: bounds.width * rf.getViewport().zoom,
    height: bounds.height * rf.getViewport().zoom,
    windowWidth: bounds.width * rf.getViewport().zoom,
    windowHeight: bounds.height * rf.getViewport().zoom,
  });
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob 失败'))), 'image/png');
  });
}

/** 用 html2pdf.js 把画布 DOM 渲染成 PDF Blob（强制白底）。 */
export async function snapshotToPdf(element: HTMLElement, suggestedName: string): Promise<Blob> {
  const mod = await import('html2pdf.js');
  const html2pdf = mod.default;
  return new Promise<Blob>((resolve, reject) => {
    html2pdf()
      .set({
        margin: 0,
        filename: suggestedName,
        image: { type: 'png', quality: 1 },
        html2canvas: { backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'pt', format: 'a4', orientation: 'landscape' },
      })
      .from(element)
      .outputPdf('blob')
      .then((blob: Blob) => resolve(blob))
      .catch((err: unknown) => reject(err));
  });
  void suggestedName;
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
