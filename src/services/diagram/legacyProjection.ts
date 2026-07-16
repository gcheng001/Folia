import { injectSceneMetadata, stripSceneMetadata } from './sceneSchema';
import { isDiagramEdge, isDiagramNode, type DiagramScene } from './types';

function setNumber(element: Element, name: string, value: number): void {
  element.setAttribute(name, Number(value.toFixed(2)).toString());
}

function elementByFoliaId(root: Element, id: string): Element | undefined {
  return Array.from(root.querySelectorAll('[data-folia-id]')).find((element) => element.getAttribute('data-folia-id') === id);
}

/** 保留旧图未识别的装饰和样式，只把场景里的定点修改投影回对应旧元素。 */
export function projectLegacySvg(originalSvg: string, scene: DiagramScene): string {
  const clean = stripSceneMetadata(originalSvg);
  const document = new DOMParser().parseFromString(clean, 'image/svg+xml');
  if (document.querySelector('parsererror')) throw new Error('旧 SVG XML 格式无效');
  const root = document.documentElement;
  const elements = Array.from(root.querySelectorAll('*'));

  for (const node of scene.elements.filter(isDiagramNode)) {
    const indexes = node.legacy?.elementIndexes ?? [];
    let group = elementByFoliaId(root, node.id);
    if (!group && indexes.length === 0) {
      group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('data-folia-id', node.id);
      group.append(document.createElementNS('http://www.w3.org/2000/svg', 'rect'), document.createElementNS('http://www.w3.org/2000/svg', 'text'));
      root.append(group);
    }
    const rect = indexes.map((index) => elements[index]).find((element) => element?.localName === 'rect') ?? group?.querySelector('rect');
    if (rect) {
      setNumber(rect, 'x', node.bounds.x);
      setNumber(rect, 'y', node.bounds.y);
      setNumber(rect, 'width', node.bounds.width);
      setNumber(rect, 'height', node.bounds.height);
      if (node.style?.fill) rect.setAttribute('fill', node.style.fill);
      if (node.style?.stroke) rect.setAttribute('stroke', node.style.stroke);
    }
    const texts = indexes.map((index) => elements[index]).filter((element) => element?.localName === 'text');
    if (texts.length === 0 && group?.querySelector('text')) texts.push(group.querySelector('text')!);
    const lines = node.text.split('\n');
    texts.forEach((text, index) => {
      text.textContent = lines[index] ?? (index === 0 ? node.text : '');
      const run = node.legacy?.textRuns?.[index];
      if (run) {
        setNumber(text, 'x', run.x);
        setNumber(text, 'y', run.y);
      }
      if (node.style?.textColor) text.setAttribute('fill', node.style.textColor);
      if (run?.fontSize) text.setAttribute('font-size', String(run.fontSize));
      else if (node.style?.fontSize) text.setAttribute('font-size', String(node.style.fontSize));
      if (indexes.length === 0) {
        text.setAttribute('text-anchor', 'middle');
        setNumber(text, 'x', node.bounds.x + node.bounds.width / 2);
        setNumber(text, 'y', node.bounds.y + node.bounds.height / 2 + (node.style?.fontSize ?? 14) * 0.35);
      }
    });
  }

  for (const edge of scene.elements.filter(isDiagramEdge)) {
    let line = (edge.legacy?.elementIndexes ?? []).map((index) => elements[index]).find((element) => element?.localName === 'line')
      ?? elementByFoliaId(root, edge.id);
    if (!line && !edge.legacy) {
      line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('data-folia-id', edge.id);
      line.setAttribute('stroke', edge.style?.color ?? '#777');
      line.setAttribute('stroke-width', String(edge.style?.width ?? 2));
      root.insertBefore(line, root.firstChild);
    }
    if (!line || !edge.points || edge.points.length < 2) continue;
    setNumber(line, 'x1', edge.points[0].x);
    setNumber(line, 'y1', edge.points[0].y);
    setNumber(line, 'x2', edge.points.at(-1)!.x);
    setNumber(line, 'y2', edge.points.at(-1)!.y);
  }

  return injectSceneMetadata(new XMLSerializer().serializeToString(root), scene);
}
