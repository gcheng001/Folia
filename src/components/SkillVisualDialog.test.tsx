import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkillVisualDialog } from './SkillVisualDialog';

describe('SkillVisualDialog', () => {
  let host: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    localStorage.clear();
    host = null;
    root = null;
  });

  it('shows every type and style beside the generation action', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(
      <SkillVisualDialog
        sourceName="案件.md"
        recommendedType="timeline"
        initialStyle="light-formal"
        phase="configure"
        stage="preparing"
        elapsedSeconds={0}
        onGenerate={() => undefined}
        onCancel={() => undefined}
        onMinimize={() => undefined}
        onClose={() => undefined}
      />,
    ));

    expect(host.textContent).toContain('流程图');
    expect(host.textContent).toContain('时间轴');
    expect(host.textContent).toContain('关系图');
    expect(host.textContent).toContain('脑图');
    expect(host.textContent).toContain('浅色正式');
    expect(host.textContent).toContain('简洁商务');
    expect(host.textContent).toContain('深色科技');
    expect(host.textContent).toContain('柔和彩色');
    expect(host.textContent).toContain('提交给 Claude 服务处理');
  });

  it('lets the user override the recommendation and style', () => {
    const onGenerate = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(
      <SkillVisualDialog
        sourceName="方案.md"
        recommendedType="mindmap"
        initialStyle="light-formal"
        phase="configure"
        stage="preparing"
        elapsedSeconds={0}
        onGenerate={onGenerate}
        onCancel={() => undefined}
        onMinimize={() => undefined}
        onClose={() => undefined}
      />,
    ));

    const buttons = Array.from(host.querySelectorAll('button'));
    act(() => buttons.find((button) => button.textContent?.includes('关系图'))?.click());
    act(() => buttons.find((button) => button.textContent?.includes('深色科技'))?.click());
    act(() => buttons.find((button) => button.textContent?.includes('开始生成'))?.click());
    expect(onGenerate).toHaveBeenCalledWith('relationship', 'dark-tech', true);
  });

  it('shows a real stage, elapsed time, and cancel action while running', () => {
    const onCancel = vi.fn();
    const onMinimize = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(
      <SkillVisualDialog
        sourceName="案件.md"
        recommendedType="timeline"
        initialStyle="light-formal"
        phase="running"
        stage="validating"
        model="MiniMax-M2.7-highspeed"
        elapsedSeconds={75}
        onGenerate={() => undefined}
        onCancel={onCancel}
        onMinimize={onMinimize}
        onClose={() => undefined}
      />,
    ));

    expect(host.textContent).toContain('Folia 正在本地排版检查');
    expect(host.textContent).toContain('1:15');
    expect(host.textContent).toContain('模型 MiniMax-M2.7-highspeed');
    const cancel = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === '取消生成');
    act(() => cancel?.click());
    expect(onCancel).toHaveBeenCalledOnce();

    const minimize = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('收起并后台运行'));
    act(() => minimize?.click());
    expect(onMinimize).toHaveBeenCalledOnce();

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(onMinimize).toHaveBeenCalledTimes(2);
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
