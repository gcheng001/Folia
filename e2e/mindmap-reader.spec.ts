import { expect, test } from '@playwright/test';

const markdown = `代理词

一、第一节点：合同关系成立并生效

该论点第一段完整正文，用于验证自然段自动成为下级节点。

该论点第二段完整正文，用于验证同一论点可以拥有多个正文子节点。

二、第二节点：对方已经构成违约

违约事实第一段完整正文。

违约事实第二段完整正文。

三、第三节点：损失计算具有依据

损失依据第一段完整正文。

损失依据第二段完整正文。

四、第四节点：请求法院支持诉请

诉讼请求第一段完整正文。

诉讼请求第二段完整正文。

诉讼请求第三段完整正文。

综上，请求法院依法支持全部诉讼请求。

此致

某某人民法院
`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ content }) => {
    const file = {
      path: '/tmp/脑图全文验收.md',
      name: '脑图全文验收.md',
      content,
      dirty: false,
      lastSavedContent: content,
      fileType: 'markdown',
    };
    const tab = {
      id: 'mindmap-reader',
      file,
      editorMode: 'mindmap',
      rightPanelMode: 'none',
      draftPersisted: true,
      isPlaceholder: false,
    };
    localStorage.setItem('folia.session.v1', JSON.stringify({
      version: 1,
      tabs: [tab],
      activeTabId: tab.id,
      recentFiles: [],
      splitTabId: null,
      splitView: false,
    }));
  }, { content: markdown });
});

test('projects 2/2/2/3 paragraphs under four arguments and reads by node', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  const workspace = page.locator('.mindmap-workspace');
  const reader = page.getByTestId('mindmap-node-reader');
  await expect(workspace).toBeVisible();
  await expect(reader).toContainText('该论点第二段完整正文');

  for (const label of ['一、第一节点', '二、第二节点', '三、第三节点', '四、第四节点']) {
    await expect(page.locator('.react-flow__node').filter({ hasText: label })).toHaveCount(1);
  }
  await expect(page.locator('[data-mindmap-node-paragraph="true"]')).toHaveCount(9);

  const paragraph = page.locator('.react-flow__node').filter({ hasText: '诉讼请求第三段完整正文' });
  await paragraph.click();
  await expect(reader).toContainText('诉讼请求第三段完整正文');
  await expect(reader).not.toContainText('诉讼请求第二段完整正文');
  await paragraph.dblclick();
  const editor = paragraph.locator('textarea[aria-label="编辑正文段落"]');
  await expect(editor).toBeVisible();
  await editor.fill('诉讼请求第三段已在脑图中修改。\n补充一行。');
  await editor.press('Control+Enter');
  await expect(page.locator('.react-flow__node').filter({ hasText: '诉讼请求第三段已在脑图中修改' })).toHaveCount(1);
  await expect(page.locator('.react-flow__node').filter({ hasText: '诉讼请求第二段完整正文' })).toHaveCount(1);

  await page.locator('.react-flow__node').filter({ hasText: '四、第四节点：请求法院支持诉请' }).click();
  await expect(reader).toContainText('诉讼请求第一段完整正文');
  await expect(reader).toContainText('综上，请求法院依法支持全部诉讼请求');
});

test('uses stacked map and reader panes in a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto('/');

  const canvasBox = await page.locator('.mindmap-canvas').boundingBox();
  const readerBox = await page.getByTestId('mindmap-node-reader').boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(readerBox).not.toBeNull();
  expect(readerBox!.y).toBeGreaterThanOrEqual(canvasBox!.y + canvasBox!.height - 1);
  expect(readerBox!.width).toBeCloseTo(canvasBox!.width, 0);
});
