import { wrapText, type TextMeasurer } from './textMeasure';
import { isDiagramEdge, isDiagramNode, type DiagramPoint, type DiagramRect, type DiagramScene } from './types';

export type DiagramQualityIssue = {
  id: string;
  severity: 'warning' | 'error';
  kind: 'text-overflow' | 'legacy-text-overlap' | 'node-overlap' | 'edge-through-node' | 'out-of-canvas' | 'small-font';
  elementIds: string[];
  message: string;
};

export function rectsOverlap(a: DiagramRect, b: DiagramRect, gap = 0): boolean {
  return a.x < b.x + b.width + gap
    && a.x + a.width + gap > b.x
    && a.y < b.y + b.height + gap
    && a.y + a.height + gap > b.y;
}

function orientation(a: DiagramPoint, b: DiagramPoint, c: DiagramPoint): number {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}

function segmentsIntersect(a: DiagramPoint, b: DiagramPoint, c: DiagramPoint, d: DiagramPoint): boolean {
  return orientation(a, b, c) * orientation(a, b, d) <= 0
    && orientation(c, d, a) * orientation(c, d, b) <= 0;
}

export function segmentIntersectsRect(start: DiagramPoint, end: DiagramPoint, rect: DiagramRect): boolean {
  if (start.x >= rect.x && start.x <= rect.x + rect.width && start.y >= rect.y && start.y <= rect.y + rect.height) return true;
  if (end.x >= rect.x && end.x <= rect.x + rect.width && end.y >= rect.y && end.y <= rect.y + rect.height) return true;
  const topLeft = { x: rect.x, y: rect.y };
  const topRight = { x: rect.x + rect.width, y: rect.y };
  const bottomLeft = { x: rect.x, y: rect.y + rect.height };
  const bottomRight = { x: rect.x + rect.width, y: rect.y + rect.height };
  return segmentsIntersect(start, end, topLeft, topRight)
    || segmentsIntersect(start, end, topRight, bottomRight)
    || segmentsIntersect(start, end, bottomRight, bottomLeft)
    || segmentsIntersect(start, end, bottomLeft, topLeft);
}

function edgePoints(scene: DiagramScene, sourceId: string, targetId: string, points?: DiagramPoint[]): DiagramPoint[] {
  if (points && points.length >= 2) return points;
  const source = scene.elements.find((element) => isDiagramNode(element) && element.id === sourceId);
  const target = scene.elements.find((element) => isDiagramNode(element) && element.id === targetId);
  if (!source || !target || !isDiagramNode(source) || !isDiagramNode(target)) return [];
  return [
    { x: source.bounds.x + source.bounds.width / 2, y: source.bounds.y + source.bounds.height / 2 },
    { x: target.bounds.x + target.bounds.width / 2, y: target.bounds.y + target.bounds.height / 2 },
  ];
}

export function inspectDiagramQuality(scene: DiagramScene, measure?: TextMeasurer): DiagramQualityIssue[] {
  const issues: DiagramQualityIssue[] = [];
  const nodes = scene.elements.filter(isDiagramNode);
  for (const node of nodes) {
    const fontSize = node.style?.fontSize ?? 14;
    const padding = 14;
    const legacyRuns = node.legacy?.textRuns ?? [];
    // 旧 SVG 的文字由多个独立 <text> 元素按原坐标排版，并不是一个需要重新换行的文本块。
    // 用整段 node.text 做普通换行检查会把已经修好的旧图误报为“文字溢出”。
    if (legacyRuns.length === 0) {
      const text = wrapText(node.text, Math.max(fontSize, node.bounds.width - padding * 2), {
        fontFamily: 'Arial, sans-serif',
        fontSize,
        fontWeight: node.style?.fontWeight,
      }, measure);
      if (text.height > node.bounds.height - padding || text.width > node.bounds.width - padding * 2 + 0.5) {
        issues.push({ id: `text-overflow:${node.id}`, severity: 'error', kind: 'text-overflow', elementIds: [node.id], message: '文字超出方框' });
      }
    }
    if (fontSize < 10) issues.push({ id: `small-font:${node.id}`, severity: 'error', kind: 'small-font', elementIds: [node.id], message: '文字小于可读字号' });
    for (let left = 0; left < legacyRuns.length; left += 1) {
      const a = legacyRuns[left];
      const aRect = { x: a.x - a.width / 2, y: a.y - a.height * 0.8, width: a.width, height: a.height };
      for (let right = left + 1; right < legacyRuns.length; right += 1) {
        const b = legacyRuns[right];
        const bRect = { x: b.x - b.width / 2, y: b.y - b.height * 0.8, width: b.width, height: b.height };
        if (rectsOverlap(aRect, bRect, 0)) {
          issues.push({ id: `legacy-text-overlap:${node.id}:${left}:${right}`, severity: 'error', kind: 'legacy-text-overlap', elementIds: [node.id], message: '旧图文字发生重叠' });
        }
      }
    }
    const b = node.bounds;
    if (b.x < 0 || b.y < 0 || b.x + b.width > scene.canvas.width || b.y + b.height > scene.canvas.height) {
      issues.push({ id: `out-of-canvas:${node.id}`, severity: 'error', kind: 'out-of-canvas', elementIds: [node.id], message: '内容超出画布' });
    }
  }

  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      if (rectsOverlap(nodes[left].bounds, nodes[right].bounds, 4)) {
        issues.push({ id: `node-overlap:${nodes[left].id}:${nodes[right].id}`, severity: 'error', kind: 'node-overlap', elementIds: [nodes[left].id, nodes[right].id], message: '方框发生重叠' });
      }
    }
  }

  for (const edge of scene.elements.filter(isDiagramEdge)) {
    // 旧图中的 <line> 既可能是关系线，也可能只是页眉、分栏或分隔装饰；导入阶段无法可靠区分。
    // 保留并允许编辑这些线，但不以低置信度映射阻断旧图导出。
    if (edge.legacy) continue;
    const points = edgePoints(scene, edge.sourceId, edge.targetId, edge.points);
    for (const node of nodes) {
      if (node.id === edge.sourceId || node.id === edge.targetId) continue;
      for (let index = 1; index < points.length; index += 1) {
        if (segmentIntersectsRect(points[index - 1], points[index], node.bounds)) {
          issues.push({ id: `edge-through-node:${edge.id}:${node.id}`, severity: 'error', kind: 'edge-through-node', elementIds: [edge.id, node.id], message: '连接线穿过无关方框' });
          break;
        }
      }
    }
  }
  return issues;
}
