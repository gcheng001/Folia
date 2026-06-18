/**
 * E2E: 验证 WysiwygEditorPane 初始化不会白屏
 *
 * 覆盖 ISS-158 修复：Vditor 初始化错误处理和内容补偿应用
 */
import { test, expect } from '@playwright/test';

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
