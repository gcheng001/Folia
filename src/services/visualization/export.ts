import { cloneWithUiHidden, sanitizeCanvasDocument } from '../../components/mindmap/exportImage';
import type { TraceableElement, VisualSheet, VisualWorkbook } from './types';

const SAFE = { bg: '#faf8f5', surface: '#ffffff', border: '#e2dfdb', fg: '#292524', muted: '#78716c', accent: '#c2412d' };

function escape(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
}

function label(sheet: VisualSheet, element: TraceableElement): string {
  const override = sheet.presentation[element.id]?.label;
  return typeof override === 'string' ? override : element.label;
}

function sheetHtml(sheet: VisualSheet): string {
  if (sheet.family === 'timeline') {
    return `<ol class="timeline">${sheet.elements.filter((item) => item.kind === 'event').map((item) => `<li><time>${escape(item.data.date)}</time><span>${escape(label(sheet, item))}</span></li>`).join('')}</ol>`;
  }
  if (sheet.family === 'matrix') {
    const cells = sheet.elements.filter((item) => item.kind === 'matrix-cell');
    const rows = Math.max(0, ...cells.map((item) => Number(item.data.row) + 1));
    const columns = Math.max(0, ...cells.map((item) => Number(item.data.column) + 1));
    return `<table>${Array.from({ length: rows }, (_, row) => `<tr>${Array.from({ length: columns }, (_, column) => {
      const cell = cells.find((item) => item.data.row === row && item.data.column === column);
      return `<td>${cell ? escape(label(sheet, cell)) : ''}</td>`;
    }).join('')}</tr>`).join('')}</table>`;
  }
  if (sheet.family === 'charts') return exportSheetSvg(sheet) ?? '';
  const nodes = sheet.elements.filter((item) => item.kind === 'node');
  const edges = sheet.elements.filter((item) => item.kind === 'edge');
  return `<section class="graph"><div>${nodes.map((item) => `<article>${escape(label(sheet, item))}</article>`).join('')}</div><ul>${edges.map((item) => `<li>${escape(label(sheet, item))}</li>`).join('')}</ul></section>`;
}

export function exportWorkbookHtml(workbook: VisualWorkbook, sheetId = workbook.activeSheetId): string {
  const sheet = workbook.sheets.find((item) => item.id === sheetId) ?? workbook.sheets[0];
  if (!sheet) throw new Error('工作簿没有可导出的页签');
  const publicTitle = workbook.title.split(/[\\/]/).pop() || 'Folia 可视化';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(publicTitle)}</title><style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;padding:32px;background:${SAFE.bg};color:${SAFE.fg};font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1080px;margin:auto}h1{font-size:24px}article,td,li{background:${SAFE.surface};border:1px solid ${SAFE.border};padding:9px}table{width:100%;border-collapse:collapse}.timeline{display:grid;gap:8px;padding:0;list-style:none}.timeline li{display:grid;grid-template-columns:130px 1fr}.timeline time{color:${SAFE.accent}.graph>div{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}.graph ul{color:${SAFE.muted}}svg{width:100%;height:auto}</style></head><body><main><h1>${escape(publicTitle)} · ${escape(sheet.name)}</h1>${sheetHtml(sheet)}</main></body></html>`;
}

export function exportSheetSvg(sheet: VisualSheet): string | null {
  if (sheet.family === 'timeline' || sheet.family === 'matrix') return null;
  const items = sheet.elements.filter((item) => item.kind === (sheet.family === 'charts' ? 'chart-point' : 'node'));
  const width = 900;
  const height = Math.max(260, Math.ceil(items.length / 3) * 130 + 60);
  if (sheet.family === 'charts') {
    const values = items.map((item) => Number(item.data.value)).filter(Number.isFinite);
    const min = Math.min(0, ...values);
    const max = Math.max(0, ...values);
    const range = max - min || 1;
    const baseline = 30 + (max / range) * 170;
    const slot = 800 / Math.max(1, items.length);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 260"><rect width="100%" height="100%" fill="${SAFE.surface}"/><line x1="50" y1="${baseline}" x2="850" y2="${baseline}" stroke="${SAFE.border}"/>${items.map((item, index) => {
      const value = Number(item.data.value);
      const valueY = 30 + ((max - value) / range) * 170;
      return `<g><rect x="${60 + index * slot}" y="${Math.min(baseline, valueY)}" width="${Math.max(16, slot - 18)}" height="${Math.max(1, Math.abs(baseline - valueY))}" fill="${SAFE.accent}"/><text x="${60 + index * slot}" y="230" fill="${SAFE.muted}" font-size="11">${escape(label(sheet, item).slice(0, 14))}</text></g>`;
    }).join('')}</svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${SAFE.bg}"/>${items.map((item, index) => {
    const saved = sheet.layout[item.id] ?? {};
    const x = typeof saved.x === 'number' ? saved.x : 40 + (index % 3) * 285;
    const y = typeof saved.y === 'number' ? saved.y : 35 + Math.floor(index / 3) * 120;
    return `<g transform="translate(${x} ${y})"><rect width="230" height="64" rx="3" fill="${SAFE.surface}" stroke="${SAFE.border}"/><text x="12" y="36" fill="${SAFE.fg}" font-size="13">${escape(label(sheet, item).slice(0, 28))}</text></g>`;
  }).join('')}</svg>`;
}

function canvasBounds(element: HTMLElement) {
  return { x: 0, y: 0, width: Math.max(320, element.scrollWidth), height: Math.max(180, element.scrollHeight) };
}

export async function exportElementPng(element: HTMLElement): Promise<Blob> {
  const bounds = canvasBounds(element);
  const { clone, cleanup } = cloneWithUiHidden(element, bounds);
  document.body.appendChild(clone);
  try {
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(clone, {
      backgroundColor: SAFE.bg,
      scale: 2,
      logging: false,
      useCORS: true,
      onclone: sanitizeCanvasDocument,
    });
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG 生成失败')), 'image/png'));
  } finally {
    cleanup();
  }
}

export async function exportElementPdf(element: HTMLElement): Promise<Blob> {
  const bounds = canvasBounds(element);
  const { clone, cleanup } = cloneWithUiHidden(element, bounds);
  document.body.appendChild(clone);
  try {
    const { default: html2pdf } = await import('html2pdf.js');
    return await html2pdf().set({
      margin: 8,
      html2canvas: { backgroundColor: SAFE.bg, scale: 2, logging: false, useCORS: true, onclone: sanitizeCanvasDocument },
      jsPDF: { unit: 'mm', format: 'a4', orientation: bounds.width > bounds.height ? 'landscape' : 'portrait' },
    }).from(clone).outputPdf('blob');
  } finally {
    cleanup();
  }
}

export function downloadExport(data: Blob | string, fileName: string, mime: string): void {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
