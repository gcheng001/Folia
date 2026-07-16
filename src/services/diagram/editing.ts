import { isDiagramNode, type DiagramScene } from './types';

export function followMovedNodes(before: DiagramScene, after: DiagramScene): void {
  const oldNodes = new Map(before.elements.filter(isDiagramNode).map((node) => [node.id, node]));
  for (const node of after.elements.filter(isDiagramNode)) {
    const old = oldNodes.get(node.id);
    if (!old) continue;
    const dx = node.bounds.x - old.bounds.x;
    const dy = node.bounds.y - old.bounds.y;
    const centerDx = dx + (node.bounds.width - old.bounds.width) / 2;
    const centerDy = dy + (node.bounds.height - old.bounds.height) / 2;
    if (dx || dy) node.legacy?.textRuns?.forEach((run) => { run.x += dx; run.y += dy; });
    if (!centerDx && !centerDy) continue;
    for (const element of after.elements) {
      if (element.kind !== 'edge' || !element.points?.length) continue;
      if (element.sourceId === node.id) {
        element.points[0].x += centerDx;
        element.points[0].y += centerDy;
      }
      if (element.targetId === node.id) {
        const last = element.points.at(-1)!;
        last.x += centerDx;
        last.y += centerDy;
      }
    }
  }
}
