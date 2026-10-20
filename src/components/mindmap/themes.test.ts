// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_ID,
  MINDMAP_THEMES,
  branchColor,
  getTheme,
  loadThemeId,
} from './themes';

describe('脑图主题（PRD 项 B）', () => {
  it('内置经典树与四套原有主题，经典树为默认', () => {
    expect(MINDMAP_THEMES.map((t) => t.id).sort()).toEqual(
      ['classic-tree', 'simple-blue', 'simple-color', 'simple-mono', 'simple-purple'],
    );
    expect(DEFAULT_THEME_ID).toBe('classic-tree');
    expect(getTheme(DEFAULT_THEME_ID).edgeVariant).toBe('classic-branch');
    expect(getTheme(DEFAULT_THEME_ID).nodeVariant).toBe('classic');
    for (const t of MINDMAP_THEMES) {
      expect(t.branchColors.length).toBeGreaterThan(0);
    }
  });

  it('未知/缺省主题 id 回退默认主题', () => {
    expect(getTheme('nonexistent').id).toBe(DEFAULT_THEME_ID);
    expect(getTheme(undefined).id).toBe(DEFAULT_THEME_ID);
  });

  it('分支配色：根用 root 色，分支按下标轮转，黑白主题恒单色', () => {
    const color = getTheme('simple-color');
    expect(branchColor(color, -1)).toBe(color.root);
    expect(branchColor(color, 0)).toBe(color.branchColors[0]);
    expect(branchColor(color, color.branchColors.length)).toBe(color.branchColors[0]);

    const mono = getTheme('simple-mono');
    expect(new Set([0, 1, 2, 5].map((i) => branchColor(mono, i))).size).toBe(1);
  });

  it('localStorage 不可用时 loadThemeId 回退默认', () => {
    expect(loadThemeId()).toBe(DEFAULT_THEME_ID);
  });
});
