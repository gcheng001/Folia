import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withSceneChecksum } from '../services/diagram/sceneSchema';
import { readSceneMetadata } from '../services/diagram/sceneSchema';
import { projectDiagramSvg } from '../services/diagram/svgProjection';
import { followMovedNodes } from '../services/diagram/editing';
import { DiagramEditorPane } from './DiagramEditorPane';

describe('DiagramEditorPane', () => {
  let host: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    host = null;
    root = null;
  });

  function render(source: string, onUpgradeLegacy = vi.fn(async () => undefined), onChange = vi.fn()) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(<DiagramEditorPane source={source} fileName="图.svg" onChange={onChange} onSaveCopy={() => undefined} onUpgradeLegacy={onUpgradeLegacy} />));
    return { onUpgradeLegacy, onChange };
  }

  it('creates an editable copy for a legacy SVG before editing', async () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 160"><rect x="50" y="40" width="180" height="70"/><text x="140" y="80">旧文字</text></svg>';
    const { onUpgradeLegacy } = render(source);
    await act(async () => host!.querySelector<HTMLButtonElement>('button')!.click());
    expect(onUpgradeLegacy).toHaveBeenCalledOnce();
    expect(onUpgradeLegacy.mock.calls[0][0]).toContain('folia-editable-visual');
  });

  it('opens a native scene and records an added node through onChange', () => {
    const now = '2026-07-13T00:00:00.000Z';
    const scene = withSceneChecksum({
      version: 1, checksum: '',
      document: { id: 'editable', title: '图', visualType: 'mindmap', style: 'light-formal', createdAt: now, updatedAt: now },
      canvas: { width: 500, height: 300, background: '#fff', padding: 32 },
      elements: [{ id: 'n1', kind: 'node', text: '节点', bounds: { x: 40, y: 40, width: 160, height: 64 } }],
      history: [],
    });
    const { onChange } = render(projectDiagramSvg(scene));
    act(() => Array.from(host!.querySelectorAll('button')).find((button) => button.textContent === '开始编辑')!.click());
    act(() => Array.from(host!.querySelectorAll('button')).find((button) => button.textContent === '添加节点')!.click());
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]).toContain('新节点');
    expect(readSceneMetadata(onChange.mock.calls[0][0])?.history).toHaveLength(1);
  });

  it('moves the connected edge endpoint with a moved node', () => {
    const now = '2026-07-13T00:00:00.000Z';
    const before = withSceneChecksum({
      version: 1, checksum: '', document: { id: 'follow', title: '跟线', visualType: 'flowchart', style: 'business', createdAt: now, updatedAt: now },
      canvas: { width: 500, height: 300, background: '#fff', padding: 32 },
      elements: [
        { id: 'a', kind: 'node', text: 'A', bounds: { x: 20, y: 20, width: 100, height: 50 } },
        { id: 'b', kind: 'node', text: 'B', bounds: { x: 250, y: 20, width: 100, height: 50 } },
        { id: 'e', kind: 'edge', sourceId: 'a', targetId: 'b', points: [{ x: 120, y: 45 }, { x: 250, y: 45 }] },
      ], history: [],
    });
    const after = structuredClone(before);
    const moved = after.elements.find((element) => element.id === 'a');
    if (moved?.kind === 'node') moved.bounds.y += 40;
    followMovedNodes(before, after);
    const edge = after.elements.find((element) => element.id === 'e');
    expect(edge?.kind === 'edge' ? edge.points?.[0] : undefined).toEqual({ x: 120, y: 85 });
  });
});
