import { withSceneChecksum } from './sceneSchema';
import { fallbackTextMeasurer } from './textMeasure';
import type { DiagramEdge, DiagramNode, DiagramRect, DiagramScene } from './types';

const FORBIDDEN = /<script\b|<foreignObject\b|javascript:|\son(?:load|click|error)\s*=|https?:\/\//iu;

function unsafeSvgScan(svg: string): string {
  return svg
    .replaceAll('http://www.w3.org/2000/svg', '')
    .replaceAll('http://www.w3.org/1999/xlink', '');
}

function numberAttribute(element: Element, name: string, fallback = 0): number {
  const raw = element.getAttribute(name) ?? '';
  if (raw.includes('%')) return Number.NaN;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

function rectContains(rect: DiagramRect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function nearestNode(nodes: DiagramNode[], x: number, y: number): DiagramNode | undefined {
  return nodes.toSorted((a, b) => {
    const ac = Math.hypot(a.bounds.x + a.bounds.width / 2 - x, a.bounds.y + a.bounds.height / 2 - y);
    const bc = Math.hypot(b.bounds.x + b.bounds.width / 2 - x, b.bounds.y + b.bounds.height / 2 - y);
    return ac - bc;
  })[0];
}

export function importLegacySvg(svg: string, title = '旧图升级'): { scene: DiagramScene; upgradedSvg: string } {
  if (FORBIDDEN.test(unsafeSvgScan(svg))) throw new Error('旧 SVG 含有脚本、外链或不安全内容，无法升级');
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (document.querySelector('parsererror')) throw new Error('旧 SVG XML 格式无效');
  const root = document.documentElement;
  if (root.localName.toLowerCase() !== 'svg') throw new Error('文件不是 SVG');
  const viewBox = (root.getAttribute('viewBox') ?? '').trim().split(/[ ,]+/u).map(Number);
  const width = viewBox.length === 4 && Number.isFinite(viewBox[2]) ? viewBox[2] : numberAttribute(root, 'width', 1200);
  const height = viewBox.length === 4 && Number.isFinite(viewBox[3]) ? viewBox[3] : numberAttribute(root, 'height', 800);
  const allElements = Array.from(root.querySelectorAll('*'));
  const rawRectEntries = allElements
    .map((element, index) => ({ element, index }))
    .filter(({ element }) => element.localName === 'rect' && numberAttribute(element, 'width') > 30 && numberAttribute(element, 'height') > 20)
    .map((entry) => ({
      ...entry,
      bounds: {
        x: numberAttribute(entry.element, 'x'),
        y: numberAttribute(entry.element, 'y'),
        width: numberAttribute(entry.element, 'width'),
        height: numberAttribute(entry.element, 'height'),
      },
    }))
    .filter(({ bounds }) => !(bounds.width >= width * 0.9 && bounds.height >= height * 0.9));
  const rectEntries = rawRectEntries.filter((candidate) => !rawRectEntries.some((outer) => {
    if (outer === candidate || outer.bounds.width * outer.bounds.height <= candidate.bounds.width * candidate.bounds.height) return false;
    const contained = candidate.bounds.x >= outer.bounds.x
      && candidate.bounds.y >= outer.bounds.y
      && candidate.bounds.x + candidate.bounds.width <= outer.bounds.x + outer.bounds.width
      && candidate.bounds.y + candidate.bounds.height <= outer.bounds.y + outer.bounds.height;
    return contained && (candidate.bounds.height <= 30 || (candidate.bounds.x === outer.bounds.x && candidate.bounds.y === outer.bounds.y));
  }));
  const textEntries = allElements
    .map((element, index) => ({ element, index }))
    .filter(({ element }) => element.localName === 'text' && Boolean(element.textContent?.trim()));

  const classFontSizes = new Map<string, number>();
  for (const styleElement of Array.from(root.querySelectorAll('style'))) {
    const css = styleElement.textContent ?? '';
    for (const match of css.matchAll(/\.([\w-]+)\s*\{[^}]*font-size\s*:\s*([\d.]+)px/giu)) {
      classFontSizes.set(match[1], Number(match[2]));
    }
  }
  const nodes: DiagramNode[] = rectEntries.map(({ element, index, bounds }, nodeIndex) => {
    return {
      id: `legacy-node-${nodeIndex + 1}`,
      kind: 'node',
      text: '',
      bounds,
      style: {
        fill: element.getAttribute('fill') ?? undefined,
        stroke: element.getAttribute('stroke') ?? undefined,
        radius: numberAttribute(element, 'rx', 6),
      },
      legacy: {
        locked: true,
        confidence: 0.45,
        elementIndexes: [index],
        textRuns: [],
      },
    };
  });
  for (const { element, index } of textEntries) {
    const x = numberAttribute(element, 'x', numberAttribute(element.querySelector('tspan') ?? element, 'x'));
    const y = numberAttribute(element, 'y', numberAttribute(element.querySelector('tspan') ?? element, 'y'));
    const candidates = nodes
      .filter((node) => rectContains(node.bounds, x, y))
      .toSorted((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height);
    const node = candidates[0];
    if (!node?.legacy) continue;
    const text = element.textContent?.trim() ?? '';
    if (!text) continue;
    const className = element.getAttribute('class') ?? '';
    const fontSize = numberAttribute(element, 'font-size', classFontSizes.get(className) ?? 12);
    node.text = node.text ? `${node.text}\n${text}` : text;
    node.legacy.locked = false;
    node.legacy.confidence = 0.9;
    node.legacy.elementIndexes.push(index);
    node.legacy.textRuns?.push({
      text,
      x,
      y,
      fontSize,
      width: fallbackTextMeasurer(text, { fontFamily: 'sans-serif', fontSize }),
      height: fontSize * 1.25,
    });
    node.style = {
      ...node.style,
      textColor: element.getAttribute('fill') ?? node.style?.textColor,
      fontSize: node.style?.fontSize ?? fontSize,
      fontWeight: element.getAttribute('font-weight') === 'bold' ? 700 : node.style?.fontWeight,
    };
  }

  const edges: DiagramEdge[] = allElements
    .map((element, index) => ({ element, index }))
    .filter(({ element }) => element.localName === 'line')
    .flatMap(({ element, index }, edgeIndex) => {
      const x1 = numberAttribute(element, 'x1');
      const y1 = numberAttribute(element, 'y1');
      const x2 = numberAttribute(element, 'x2');
      const y2 = numberAttribute(element, 'y2');
      const source = nearestNode(nodes, x1, y1);
      const target = nearestNode(nodes.filter((node) => node.id !== source?.id), x2, y2);
      if (!source || !target) return [];
      return [{
        id: `legacy-edge-${edgeIndex + 1}`,
        kind: 'edge' as const,
        sourceId: source.id,
        targetId: target.id,
        points: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        style: { color: element.getAttribute('stroke') ?? undefined, width: numberAttribute(element, 'stroke-width', 2) },
        legacy: { locked: false, confidence: 0.72, elementIndexes: [index] },
      }];
    });

  const now = new Date().toISOString();
  const scene = withSceneChecksum({
    version: 1,
    checksum: '',
    document: {
      id: `legacy-${Date.now().toString(36)}`,
      title,
      visualType: 'relationship',
      style: 'light-formal',
      createdAt: now,
      updatedAt: now,
      legacyProjection: true,
    },
    canvas: { width, height, background: root.querySelector('rect')?.getAttribute('fill') ?? '#ffffff', padding: 32 },
    elements: [...nodes, ...edges],
    history: [],
  });

  const closing = svg.lastIndexOf('</svg>');
  if (closing < 0) throw new Error('旧 SVG 缺少结束标签');
  const payload = JSON.stringify(scene).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const metadata = `<metadata id="folia-editable-visual" data-version="1">${payload}</metadata>`;
  return { scene, upgradedSvg: `${svg.slice(0, closing)}${metadata}${svg.slice(closing)}` };
}
