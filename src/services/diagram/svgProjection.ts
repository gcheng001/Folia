import { wrapText, type TextMeasurer } from './textMeasure';
import { injectSceneMetadata, withSceneChecksum } from './sceneSchema';
import { isDiagramEdge, isDiagramNode, type DiagramNode, type DiagramScene } from './types';

const PALETTES = {
  'light-formal': { background: '#fbf8f2', fill: '#fffdf8', stroke: '#9a5c3d', text: '#302721', edge: '#876b5b' },
  business: { background: '#f5f7f9', fill: '#ffffff', stroke: '#516b7b', text: '#24323a', edge: '#6a7c87' },
  'dark-tech': { background: '#151b24', fill: '#202b38', stroke: '#63b3ed', text: '#edf5ff', edge: '#7f9db3' },
  'soft-color': { background: '#faf7fb', fill: '#fffafe', stroke: '#9b7aa0', text: '#3d3340', edge: '#a58ba9' },
} as const;

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function nodeCenter(node: DiagramNode) {
  return { x: node.bounds.x + node.bounds.width / 2, y: node.bounds.y + node.bounds.height / 2 };
}

export function projectDiagramSvg(input: DiagramScene, options?: { editable?: boolean; measure?: TextMeasurer }): string {
  const scene = withSceneChecksum(input);
  const palette = PALETTES[scene.document.style];
  const nodes = scene.elements.filter(isDiagramNode);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.canvas.width}" height="${scene.canvas.height}" viewBox="0 0 ${scene.canvas.width} ${scene.canvas.height}">`,
    '<defs><marker id="folia-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="context-stroke"/></marker></defs>',
    `<rect width="100%" height="100%" fill="${escapeXml(scene.canvas.background || palette.background)}"/>`,
  ];

  for (const edge of scene.elements.filter(isDiagramEdge)) {
    const source = nodeById.get(edge.sourceId);
    const target = nodeById.get(edge.targetId);
    if (!source || !target) continue;
    const points = edge.points?.length ? edge.points : [nodeCenter(source), nodeCenter(target)];
    const data = points.map((point) => `${point.x},${point.y}`).join(' ');
    const color = edge.style?.color ?? palette.edge;
    parts.push(`<polyline data-folia-id="${escapeXml(edge.id)}" points="${data}" fill="none" stroke="${escapeXml(color)}" stroke-width="${edge.style?.width ?? 2}"${edge.style?.dashed ? ' stroke-dasharray="7 5"' : ''}${edge.style?.arrow === 'none' ? '' : ' marker-end="url(#folia-arrow)"'}/>`);
  }

  for (const node of nodes) {
    const fill = node.style?.fill ?? palette.fill;
    const stroke = node.style?.stroke ?? palette.stroke;
    const textColor = node.style?.textColor ?? palette.text;
    const fontSize = node.style?.fontSize ?? 14;
    const wrapped = wrapText(node.text, Math.max(fontSize, node.bounds.width - 28), {
      fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
      fontSize,
      fontWeight: node.style?.fontWeight ?? 500,
    }, options?.measure);
    parts.push(`<g data-folia-id="${escapeXml(node.id)}">`);
    parts.push(`<rect x="${node.bounds.x}" y="${node.bounds.y}" width="${node.bounds.width}" height="${node.bounds.height}" rx="${node.style?.radius ?? 8}" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="1.5"/>`);
    const firstY = node.bounds.y + (node.bounds.height - wrapped.height) / 2 + wrapped.lineHeight * 0.78;
    parts.push(`<text x="${node.bounds.x + node.bounds.width / 2}" y="${firstY}" text-anchor="middle" fill="${escapeXml(textColor)}" font-family="-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif" font-size="${fontSize}" font-weight="${node.style?.fontWeight ?? 500}">`);
    wrapped.lines.forEach((line, index) => parts.push(`<tspan x="${node.bounds.x + node.bounds.width / 2}" dy="${index === 0 ? 0 : wrapped.lineHeight}">${escapeXml(line)}</tspan>`));
    parts.push('</text></g>');
  }
  parts.push('</svg>');
  const svg = parts.join('');
  return options?.editable === false ? svg : injectSceneMetadata(svg, scene);
}
