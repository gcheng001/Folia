import { expect, test } from '@playwright/test';

function editableSvg(): string {
  const scene = {
    version: 1 as const,
    checksum: '',
    document: { id: 'e2e-visual', title: '案情图', visualType: 'mindmap', style: 'light-formal', createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z' },
    canvas: { width: 500, height: 300, background: '#fff', padding: 32 },
    elements: [{ id: 'n1', kind: 'node', text: '签约', bounds: { x: 40, y: 40, width: 160, height: 64 } }],
    history: [],
  };
  let hash = 0x811c9dc5;
  for (const char of JSON.stringify(scene)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  scene.checksum = (hash >>> 0).toString(16).padStart(8, '0');
  const metadata = JSON.stringify(scene).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 300"><rect width="500" height="300" fill="#fff"/><rect x="40" y="40" width="160" height="64"/><text x="120" y="76">签约</text><metadata id="folia-editable-visual" data-version="1">${metadata}</metadata></svg>`;
}

test('restores Markdown-diagram comparison and edits the right diagram', async ({ page }) => {
  await page.addInitScript(({ svg }) => {
    const markdownFile = { path: '/tmp/案情.md', name: '案情.md', content: '# 案情\n\n签约', dirty: false, lastSavedContent: '# 案情\n\n签约', fileType: 'markdown' };
    const svgFile = { path: '/tmp/案情-脑图-01.svg', name: '案情-脑图-01.svg', content: svg, dirty: false, lastSavedContent: svg, fileType: 'svg' };
    const common = { editorMode: 'wysiwyg', rightPanelMode: 'none', draftPersisted: true, isPlaceholder: false };
    const left = { id: 'left-md', file: markdownFile, ...common };
    const right = { id: 'right-svg', file: svgFile, ...common };
    localStorage.setItem('folia.session.v1', JSON.stringify({ version: 1, tabs: [left, right], activeTabId: left.id, recentFiles: [], splitTabId: right.id, splitView: true }));
  }, { svg: editableSvg() });

  await page.goto('/');
  await expect(page.locator('.wysiwyg-editor-pane')).toBeVisible();
  await expect(page.locator('.editor-pane-split')).toContainText('案情-脑图-01.svg');
  await expect(page.getByRole('button', { name: '重新生成' })).toBeVisible();
  await page.getByRole('button', { name: '开始编辑' }).click();
  await expect(page.locator('.diagram-editor-pane')).toBeVisible();
  await page.locator('.diagram-editor-stage svg rect').click();
  await page.locator('.diagram-editor-inspector textarea').fill('签约并付款');
  await expect(page.locator('.diagram-editor-inspector textarea')).toHaveValue('签约并付款');
  await expect(page.locator('.diagram-editor-toolbar')).toContainText('排版检查通过');
  await expect(page.locator('.tabbar-dirty')).toHaveCount(1);
});
