import { inspectDiagramQuality, rectsOverlap } from './collision';
import { withSceneChecksum } from './sceneSchema';
import { wrapText } from './textMeasure';
import { isDiagramNode, type DiagramNode, type DiagramScene } from './types';

function movable(node: DiagramNode): boolean {
  return !node.legacy?.locked && !node.protected?.position;
}

export function repairDiagramLocally(input: DiagramScene, gap = 24): DiagramScene {
  const scene: DiagramScene = structuredClone(input);
  const nodes = scene.elements.filter(isDiagramNode);
  for (const node of nodes) {
    const runs = node.legacy?.textRuns;
    if (!node.protected?.style && (node.style?.fontSize ?? 14) < 10) {
      node.style = { ...node.style, fontSize: 10 };
    }
    if (movable(node)) {
      node.bounds.x = Math.max(0, node.bounds.x);
      node.bounds.y = Math.max(0, node.bounds.y);
    }
    if ((!runs || runs.length === 0) && !node.protected?.size) {
      const fontSize = node.style?.fontSize ?? 14;
      const padding = 14;
      const wrapped = wrapText(node.text, Math.max(fontSize, node.bounds.width - padding * 2), {
        fontFamily: 'Arial, sans-serif',
        fontSize,
        fontWeight: node.style?.fontWeight,
      });
      node.bounds.height = Math.max(node.bounds.height, wrapped.height + padding);
    }
    if (!runs || runs.length < 2 || !movable(node)) continue;
    const ordered = runs.toSorted((a, b) => a.y - b.y);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      const minimumY = previous.y + Math.max(previous.height, current.height) * 1.12;
      if (current.y < minimumY) current.y = minimumY;
    }
    const last = ordered.at(-1)!;
    const requiredBottom = last.y + last.height * 0.35 + 12;
    if (requiredBottom > node.bounds.y + node.bounds.height && !node.protected?.size) {
      node.bounds.height = requiredBottom - node.bounds.y;
    }
  }
  for (let pass = 0; pass < Math.max(4, nodes.length * 2); pass += 1) {
    let changed = false;
    for (let left = 0; left < nodes.length; left += 1) {
      for (let right = left + 1; right < nodes.length; right += 1) {
        const a = nodes[left];
        const b = nodes[right];
        if (!rectsOverlap(a.bounds, b.bounds, gap)) continue;
        const target = movable(b) ? b : movable(a) ? a : null;
        if (!target) continue;
        const anchor = target === b ? a : b;
        target.bounds.y = anchor.bounds.y + anchor.bounds.height + gap;
        changed = true;
      }
    }
    if (!changed) break;
  }

  const maxX = Math.max(scene.canvas.width, ...nodes.map((node) => node.bounds.x + node.bounds.width + scene.canvas.padding));
  const maxY = Math.max(scene.canvas.height, ...nodes.map((node) => node.bounds.y + node.bounds.height + scene.canvas.padding));
  scene.canvas.width = Math.ceil(maxX);
  scene.canvas.height = Math.ceil(maxY);
  scene.document.updatedAt = new Date().toISOString();
  return withSceneChecksum(scene);
}

export function hasRepairableOverlap(scene: DiagramScene): boolean {
  return inspectDiagramQuality(scene).some((issue) => issue.kind === 'node-overlap');
}
