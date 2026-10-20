import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVisualWorkbookDraft } from '../../services/visualization/draft';
import { serializeVisualWorkbook } from '../../services/visualization/schema';
import { VisualWorkbookPane } from './VisualWorkbookPane';

describe('VisualWorkbookPane', () => {
  let host: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    host = null;
    root = null;
  });

  it('renders a generated sheet and writes display overrides only', () => {
    const workbook = createVisualWorkbookDraft({ markdown: '2024年1月2日 签订合同。\n2024年2月3日 完成交付。', sourceName: 'case.md', now: 1 });
    const onChange = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<VisualWorkbookPane content={serializeVisualWorkbook(workbook)} onChange={onChange} />));

    expect(host.querySelector('[aria-label="可视化工作簿"]')).not.toBeNull();
    expect(host.textContent).toContain('时间轴');
    const input = host.querySelector('input') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '展示简称');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalled();
    const saved = JSON.parse(onChange.mock.calls.at(-1)?.[0] as string);
    expect(saved.sheets[0].presentation[saved.sheets[0].elements[0].id].label).toBe('展示简称');
    expect(saved.sheets[0].elements[0].anchor.excerpt).toBe('2024年1月2日 签订合同。');
  });

  it('shows a validation error instead of rendering broken JSON', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<VisualWorkbookPane content="{" onChange={() => undefined} />));
    expect(host.getAttribute('role')).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('无法打开可视化工作簿');
  });

  it('shows a source diff and waits for confirmation before writing Markdown', () => {
    const source = '2024年1月2日 错误事件。\n2024年2月3日 后续事件。';
    const workbook = createVisualWorkbookDraft({ markdown: source, sourceName: 'case.md', now: 1 });
    const element = workbook.sheets[0].elements[0];
    workbook.sheets[0].presentation[element.id] = { label: '正确事件。' };
    const onApplySourceChange = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(
      <VisualWorkbookPane
        content={serializeVisualWorkbook(workbook)}
        onChange={() => undefined}
        sourceMarkdown={source}
        onApplySourceChange={onApplySourceChange}
      />,
    ));

    const syncButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === '同步修正原文');
    act(() => syncButton?.click());
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('错误事件');
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('正确事件');
    expect(onApplySourceChange).not.toHaveBeenCalled();

    const confirm = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === '确认写回 Markdown');
    act(() => confirm?.click());
    expect(onApplySourceChange).toHaveBeenCalledWith('2024年1月2日 正确事件。\n2024年2月3日 后续事件。');
  });

  it('adds a view-only annotation without a source anchor', () => {
    const workbook = createVisualWorkbookDraft({ markdown: '2024年1月2日 事件一。\n2024年2月3日 事件二。', sourceName: 'case.md', now: 1 });
    const onChange = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<VisualWorkbookPane content={serializeVisualWorkbook(workbook)} onChange={onChange} />));
    const add = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === '添加视图注释');
    act(() => add?.click());
    const saved = JSON.parse(onChange.mock.calls.at(-1)?.[0] as string);
    expect(saved.sheets[0].annotations[0].label).toBe('新建视图注释');
    expect(saved.sheets[0].annotations[0].boundAnchor).toBeUndefined();
  });
});
