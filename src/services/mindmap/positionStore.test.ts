// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { loadMindMapPositions, saveMindMapPositions } from './positionStore';

class StorageStub {
  private data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  clear(): void { this.data.clear(); }
}

const storage = new StorageStub();

beforeEach(() => storage.clear());

describe('mindmap positionStore', () => {
  it('按文件与节点内容路径保存并恢复有限坐标', () => {
    saveMindMapPositions('/案件/报告.md', {
      '报告/争点': { x: 321.5, y: -42 },
    }, storage);
    expect(loadMindMapPositions('/案件/报告.md', storage)).toEqual({
      '报告/争点': { x: 321.5, y: -42 },
    });
    expect(loadMindMapPositions('/案件/另一份.md', storage)).toEqual({});
  });

  it('损坏 JSON 与非有限坐标安全回退', () => {
    storage.setItem('folia.mindmap.positions.v1:bad', '{broken');
    expect(loadMindMapPositions('bad', storage)).toEqual({});
    storage.setItem('folia.mindmap.positions.v1:invalid', JSON.stringify({
      ok: { x: 1, y: 2 },
      bad: { x: 'x', y: 3 },
    }));
    expect(loadMindMapPositions('invalid', storage)).toEqual({ ok: { x: 1, y: 2 } });
  });
});
