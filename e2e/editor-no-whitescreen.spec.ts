/**
 * E2E: 验证 WysiwygEditorPane 初始化不会白屏
 *
 * 覆盖 ISS-158 修复：Vditor 初始化错误处理和内容补偿应用
 */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('folia.session.v1')) return;
    const file = { path: '', name: '未命名', content: '', dirty: false, lastSavedContent: '', fileType: 'markdown' };
    const tab = { id: 'e2e-draft', file, editorMode: 'wysiwyg', rightPanelMode: 'none', draftPersisted: true, isPlaceholder: false };
    localStorage.setItem('folia.session.v1', JSON.stringify({ version: 1, tabs: [tab], activeTabId: tab.id, recentFiles: [], splitTabId: null, splitView: false }));
  });
});

test.describe('Editor initialization robustness', () => {
  test('editor pane shows content after Vditor initializes (not white screen)', async ({ page }) => {
    await page.goto('/');

    // 1. WysiwygEditorPane 容器必须存在
    const pane = page.locator('.wysiwyg-editor-pane');
    await expect(pane).toBeVisible({ timeout: 10000 });

    // 2. 不能显示错误状态
    const errorPane = page.locator('.wysiwyg-editor-pane--error');
    await expect(errorPane).toHaveCount(0);

    // 3. Vditor IR 容器必须在合理时间内出现
    const irContainer = page.locator('.wysiwyg-editor-pane .vditor-ir');
    await expect(irContainer).toBeVisible({ timeout: 10000 });

    // 4. Vditor 渲染区域（.vditor-reset）必须存在且可见
    const resetArea = page.locator('.wysiwyg-editor-pane .vditor-ir .vditor-reset');
    await expect(resetArea).toBeVisible({ timeout: 5000 });
  });

  test('editor does not show error state on cold start', async ({ page }) => {
    // 清除缓存模拟冷启动
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    const errorPane = page.locator('.wysiwyg-editor-pane--error');
    await expect(errorPane).toHaveCount(0);

    // 等待 editor 完成初始化
    const irContainer = page.locator('.wysiwyg-editor-pane .vditor-ir');
    await expect(irContainer).toBeVisible({ timeout: 15000 });
  });

  test('long WYSIWYG document remains editable without jumping to the top', async ({ page }) => {
    const marker = 'FOLIA_EDIT_PROBE';
    const content = Array.from(
      { length: 240 },
      (_, index) => `## 第 ${index + 1} 节\n\n这是第 ${index + 1} 段正文。`,
    ).join('\n\n');

    await page.goto('/');
    await page.getByRole('button', { name: '源码模式' }).click();
    await page.locator('.cm-content').click();
    await page.keyboard.insertText(content);
    await page.getByRole('button', { name: '源码模式' }).click();

    const editor = page.locator('.wysiwyg-editor-pane .vditor-ir > .vditor-reset');
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await editor.locator(':scope > *').last().click();
    await page.keyboard.press('End');
    const scrollTop = await editor.evaluate((element) => element.scrollTop);

    await page.keyboard.type(marker);

    await expect(editor).toContainText(marker);
    await expect.poll(() => editor.evaluate((element) => element.scrollTop)).toBeGreaterThanOrEqual(scrollTop - 50);
    await expect.poll(() => page.evaluate((text) => (localStorage.getItem('folia.session.v1') ?? '').includes(text), marker)).toBe(true);
  });

  test('error state with retry button is shown when Vditor fails to load', async ({ page }) => {
    // 拦截 Vditor 模块加载
    await page.route('**/.vite/deps/vditor.js*', (route) => route.abort());
    await page.route('**/vditor-vendor-*.js', (route) => route.abort());

    await page.goto('/');

    // 应该显示错误状态而不是静默白屏
    const errorPane = page.locator('.wysiwyg-editor-pane--error');
    await expect(errorPane).toBeVisible({ timeout: 15000 });

    // 错误状态应该包含重试按钮
    const retryButton = page.locator('.wysiwyg-editor-error button');
    await expect(retryButton).toBeVisible();
    await expect(retryButton).toContainText(/重试|Retry|再試行/);
  });
});
