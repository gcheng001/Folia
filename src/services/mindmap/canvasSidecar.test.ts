// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PALETTE,
  emptySidecar,
  loadCanvasSidecar,
  recordColor,
  saveCanvasSidecar,
} from './canvasSidecar';

class StorageStub {
  private data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  clear(): void { this.data.clear(); }
}

const storage = new StorageStub();

beforeEach(() => storage.clear());

describe('canvasSidecar', () => {
  it('空文档返回默认空 sidecar', () => {
    expect(loadCanvasSidecar('/abs/x.md', storage)).toEqual(emptySidecar());
  });

  it('按文件隔离：不同 documentKey 不串数据', () => {
    saveCanvasSidecar('/abs/a.md', { ...emptySidecar(), positions: { root: { x: 1, y: 2 } } }, storage);
    saveCanvasSidecar('/abs/b.md', { ...emptySidecar(), edgeMode: 'flow' }, storage);
    expect(loadCanvasSidecar('/abs/a.md', storage).positions).toEqual({ root: { x: 1, y: 2 } });
    expect(loadCanvasSidecar('/abs/a.md', storage).edgeMode).toBe('mindmap');
    expect(loadCanvasSidecar('/abs/b.md', storage).edgeMode).toBe('flow');
  });

  it('损坏 JSON 安全回退', () => {
    storage.setItem('folia.mindmap.canvas.v2:bad', '{broken');
    expect(loadCanvasSidecar('bad', storage)).toEqual(emptySidecar());
  });

  it('结构损坏字段被丢弃，未损坏字段保留', () => {
    storage.setItem('folia.mindmap.canvas.v2:mixed', JSON.stringify({
      positions: { ok: { x: 1, y: 2 }, bad: { x: 'x' } },
      customEdges: [
        { id: 'e1', source: 'n1', target: 'n2', arrow: 'one-way', shape: 'straight', dash: 'solid', color: '#000', width: 1.5 },
        { id: 'e2', source: 'n1' /* missing fields */ },
      ],
      edgeMode: 'flow',
      colorHistory: ['#000', 42, '#fff'],
    }));
    const got = loadCanvasSidecar('mixed', storage);
    expect(got.positions).toEqual({ ok: { x: 1, y: 2 } });
    expect(got.customEdges).toHaveLength(1);
    expect(got.customEdges[0].id).toBe('e1');
    expect(got.edgeMode).toBe('flow');
    expect(got.colorHistory).toEqual(['#000', '#fff']);
  });

  it('默认调色板为 8 色', () => {
    expect(DEFAULT_PALETTE).toHaveLength(8);
  });

  it('recordColor 去重置顶、限长 8', () => {
    const s = emptySidecar();
    recordColor(s, '#111');
    recordColor(s, '#222');
    recordColor(s, '#111'); // 移到队首
    expect(s.colorHistory[0]).toBe('#111');
    expect(s.colorHistory).toEqual(['#111', '#222']);
  });
});
