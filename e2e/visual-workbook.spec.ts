import { expect, test } from '@playwright/test';

test('one-click visualization creates a separate workbook and preserves Markdown', async ({ page }) => {
  const markdown = '# 案件经过\n2024年1月2日 签订合同。\n2024年2月3日 完成交付。';
  await page.addInitScript((content) => {
    localStorage.setItem('folia.session.v1', JSON.stringify({
      version: 1,
      tabs: [{
        id: 'source-tab',
        file: {
          path: '/tmp/case.md',
          name: 'case.md',
          content,
          dirty: false,
          lastSavedContent: content,
          fileType: 'markdown',
        },
        editorMode: 'wysiwyg',
        rightPanelMode: 'none',
        draftPersisted: true,
        isPlaceholder: false,
      }],
      activeTabId: 'source-tab',
      recentFiles: [],
      splitTabId: null,
      splitView: false,
    }));
  }, markdown);

  await page.goto('/');
  await page.getByRole('button', { name: '一键可视化' }).click();

  await expect(page.getByLabel('可视化工作簿')).toBeVisible();
  await expect(page.getByRole('tab', { name: /case\.foliaviz/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '放弃新建 Markdown' })).toHaveCount(0);
  await page.getByText('导出', { exact: true }).click();
  await expect(page.getByRole('button', { name: /HTML 网页/ })).toBeVisible();

  await page.getByRole('tab', { name: /case\.md/ }).click();
  await page.getByRole('button', { name: '源码模式' }).click();
  await expect(page.locator('.cm-content')).toContainText('签订合同');
  await expect(page.locator('.cm-content')).toContainText('完成交付');
});

test('large structure workbooks open as a readable focused graph', async ({ page }) => {
  const markdown = Array.from({ length: 26 }, (_, index) => `${index === 0 ? '#' : '##'} 第${index + 1}部分\n- 第${index + 1}项关键内容`).join('\n');
  await page.addInitScript((content) => {
    localStorage.setItem('folia.session.v1', JSON.stringify({
      version: 1,
      tabs: [{
        id: 'source-tab',
        file: { path: '/tmp/large.md', name: 'large.md', content, dirty: false, lastSavedContent: content, fileType: 'markdown' },
        editorMode: 'wysiwyg', rightPanelMode: 'none', draftPersisted: true, isPlaceholder: false,
      }],
      activeTabId: 'source-tab', recentFiles: [], splitTabId: null, splitView: false,
    }));
  }, markdown);

  await page.goto('/');
  await page.getByRole('button', { name: '一键可视化' }).click();
  await expect(page.locator('.visual-flow-node')).toHaveCount(12);
  await expect(page.getByText(/展开其余 \d+ 个/)).toBeVisible();
  await expect(page.locator('.visual-edge-editor')).toHaveCount(0);
  await expect(page.locator('.visual-node-content button').first()).toBeVisible();
});
