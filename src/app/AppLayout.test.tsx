// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLayout } from './AppLayout';
import type { UpdateCheckResult } from '../services/updateService';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const updateServiceMock = vi.hoisted(() => ({
  checkForAppUpdate: vi.fn<() => Promise<UpdateCheckResult>>(),
  downloadAppUpdate: vi.fn<() => Promise<void>>(),
  installDownloadedAppUpdate: vi.fn<() => Promise<void>>(),
}));

const tauriWindowMock = vi.hoisted(() => ({
  onDragDropEvent: vi.fn().mockResolvedValue(vi.fn()),
  setTitle: vi.fn().mockResolvedValue(undefined),
}));

const tauriCoreMock = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

const tauriEventMock = vi.hoisted(() => ({
  listen: vi.fn(),
}));

const fileServiceMock = vi.hoisted(() => ({
  openFile: vi.fn(),
  openPath: vi.fn(),
  saveFile: vi.fn(),
  saveFileAs: vi.fn(),
}));

const editorPaneMock = vi.hoisted(() => ({
  source: '',
  renderCount: 0,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => tauriWindowMock,
}));

vi.mock('@tauri-apps/api/core', () => tauriCoreMock);

vi.mock('@tauri-apps/api/event', () => tauriEventMock);

vi.mock('../services/fileService', () => fileServiceMock);

vi.mock('../services/updateService', () => ({
  checkForAppUpdate: updateServiceMock.checkForAppUpdate,
  downloadAppUpdate: updateServiceMock.downloadAppUpdate,
  installDownloadedAppUpdate: updateServiceMock.installDownloadedAppUpdate,
}));

vi.mock('../components/EditorPane', () => ({
  EditorPane: ({ source }: { source: string }) => {
    editorPaneMock.source = source;
    editorPaneMock.renderCount += 1;
    return null;
  },
}));

vi.mock('../components/WysiwygEditorPane', () => ({
  WysiwygEditorPane: () => null,
}));

vi.mock('../components/SettingsPage', () => ({
  SettingsPage: () => (
    <div className="settings-overlay" data-testid="settings-page-stub">
      <div className="settings-modal">
        <div className="settings-modal-content">settings-page-content</div>
      </div>
    </div>
  ),
}));

vi.mock('../components/settings/preloadSections', () => ({
  preloadGeneralSection: () => Promise.resolve(),
  preloadEditorSection: () => Promise.resolve(),
  preloadPreviewSection: () => Promise.resolve(),
  preloadAppearanceSection: () => Promise.resolve(),
  preloadExportSection: () => Promise.resolve(),
  preloadHtmlExportSection: () => Promise.resolve(),
  preloadLicenseSection: () => Promise.resolve(),
  preloadAboutSection: () => Promise.resolve(),
}));

function flushPromises(): Promise<void> {
  return Promise.resolve();
}

describe('AppLayout update flow', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    tauriWindowMock.onDragDropEvent.mockResolvedValue(vi.fn());
    tauriWindowMock.setTitle.mockResolvedValue(undefined);
    tauriCoreMock.invoke.mockResolvedValue([]);
    tauriEventMock.listen.mockResolvedValue(vi.fn());
    fileServiceMock.openFile.mockResolvedValue(null);
    fileServiceMock.openPath.mockImplementation(async (path: string) => ({
      path,
      name: path.split('/').pop() ?? '未命名',
      content: '# 系统打开文件',
      dirty: false,
      lastSavedContent: '# 系统打开文件',
      fileType: 'markdown',
    }));
    editorPaneMock.source = '';
    editorPaneMock.renderCount = 0;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('downloads detected updates silently before showing the restart button', async () => {
    let resolveDownload: () => void = () => {};
    const availableUpdate = {
      status: 'available',
      version: '0.3.11',
      body: '',
      update: {},
    } as Extract<UpdateCheckResult, { status: 'available' }>;
    updateServiceMock.checkForAppUpdate.mockResolvedValue(availableUpdate);
    updateServiceMock.downloadAppUpdate.mockImplementation(() => new Promise((resolve) => {
      resolveDownload = resolve;
    }));

    await act(async () => {
      root.render(<AppLayout />);
      await flushPromises();
    });

    await act(async () => {
      vi.advanceTimersByTime(2600);
      await flushPromises();
    });

    expect(updateServiceMock.checkForAppUpdate).toHaveBeenCalledTimes(1);
    expect(updateServiceMock.downloadAppUpdate).toHaveBeenCalledTimes(1);
    expect(updateServiceMock.downloadAppUpdate.mock.calls[0]).toHaveLength(1);
    expect(host.textContent).not.toContain('重启更新');

    await act(async () => {
      resolveDownload();
      await flushPromises();
    });

    expect(host.textContent).toContain('重启更新');
  });

  it('opens a file path delivered by the desktop system open event', async () => {
    tauriCoreMock.invoke.mockResolvedValue(['/tmp/系统打开.md']);

    await act(async () => {
      root.render(<AppLayout />);
      await flushPromises();
      await flushPromises();
    });

    expect(tauriEventMock.listen).toHaveBeenCalledWith('opened-paths', expect.any(Function));
    expect(fileServiceMock.openPath).toHaveBeenCalledWith('/tmp/系统打开.md', 'UTF-8');
  });

  it('passes the current HTML source into the source editor from the WYSIWYG pane', async () => {
    const source = '<!doctype html><html><body><h1>材料</h1><table><tr><td>正文</td></tr></table></body></html>';
    fileServiceMock.openFile.mockResolvedValue({
      path: '/tmp/materials.html',
      name: 'materials.html',
      content: source,
      dirty: false,
      lastSavedContent: source,
      fileType: 'html',
    });

    await act(async () => {
      root.render(<AppLayout />);
      await flushPromises();
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', metaKey: true }));
      await flushPromises();
      await flushPromises();
    });

    const sourceButton = host.querySelector<HTMLButtonElement>('button[aria-label="源码模式"]');
    expect(sourceButton).toBeTruthy();

    await act(async () => {
      sourceButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushPromises();
      await flushPromises();
    });

    expect(editorPaneMock.renderCount).toBeGreaterThan(0);
    expect(editorPaneMock.source).toBe(source);
  });

  it('restores the previous file after discarding a new Markdown draft', async () => {
    const content = '# 原文件';
    fileServiceMock.openFile.mockResolvedValue({
      path: '/tmp/original.md',
      name: 'original.md',
      content,
      dirty: false,
      lastSavedContent: content,
      fileType: 'markdown',
    });

    await act(async () => {
      root.render(<AppLayout />);
      await flushPromises();
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', metaKey: true }));
      await flushPromises();
      await flushPromises();
    });

    expect(host.textContent).toContain('original.md');

    const newButton = host.querySelector<HTMLButtonElement>('button[aria-label="新建 Markdown"]');
    expect(newButton).toBeTruthy();

    await act(async () => {
      newButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushPromises();
    });

    expect(host.textContent).toContain('未命名');

    const discardButton = host.querySelector<HTMLButtonElement>('button[aria-label="放弃新建 Markdown"]');
    expect(discardButton).toBeTruthy();

    await act(async () => {
      discardButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushPromises();
    });

    expect(host.textContent).toContain('original.md');
    expect(host.textContent).not.toContain('未命名');
  });

  it('creates an independent dirty visualization tab without changing the source Markdown', async () => {
    const content = '# 案件经过\n2024年1月2日 签订合同。\n2024年2月3日 完成交付。';
    fileServiceMock.openFile.mockResolvedValue({
      path: '/tmp/case.md',
      name: 'case.md',
      content,
      dirty: false,
      lastSavedContent: content,
      fileType: 'markdown',
    });

    await act(async () => {
      root.render(<AppLayout />);
      await flushPromises();
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', metaKey: true }));
      for (let i = 0; i < 3; i += 1) await flushPromises();
    });

    const visualizeButton = host.querySelector<HTMLButtonElement>('button[aria-label="一键可视化"]');
    expect(visualizeButton).toBeTruthy();
    const mindMapButton = host.querySelector<HTMLButtonElement>('button[aria-label="脑图"]');
    expect(mindMapButton).toBeTruthy();

    await act(async () => {
      visualizeButton?.click();
      await vi.dynamicImportSettled();
      for (let i = 0; i < 6; i += 1) await flushPromises();
    });
    await act(async () => {
      await vi.dynamicImportSettled();
      await flushPromises();
    });

    const visualTab = host.querySelector<HTMLElement>('[role="tab"][title="case.foliaviz"]');
    expect(visualTab).toBeTruthy();
    expect(visualTab?.querySelector('[data-dirty]')).toBeTruthy();
    expect(host.querySelector('[aria-label="可视化工作簿"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="放弃新建 Markdown"]')).toBeNull();

    const sourceTab = host.querySelector<HTMLElement>('[role="tab"][title="/tmp/case.md"]');
    await act(async () => {
      sourceTab?.click();
      await flushPromises();
      host.querySelector<HTMLButtonElement>('button[aria-label="源码模式"]')?.click();
      for (let i = 0; i < 3; i += 1) await flushPromises();
    });

    expect(editorPaneMock.source).toBe(content);
  });
});

describe('AppLayout settings first-open', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.clearAllMocks();
  });

  it('preloads the settings chunk immediately on mount, without a 500ms delay', async () => {
    await act(async () => {
      root.render(<AppLayout />);
      await flushPromises();
    });

    /* No timer advancement — the preload must already be in flight. */
    expect(host.querySelector('.settings-overlay')).toBeNull();
  });

  it('renders the real settings page on the first frame after opening, not the skeleton fallback', async () => {
    await act(async () => {
      root.render(<AppLayout />);
      await flushPromises();
    });

    const settingsButton = host.querySelector<HTMLButtonElement>('button[aria-label="设置"]');
    expect(settingsButton).not.toBeNull();

    /* After the preload Promise resolves and the click is flushed, the
       settings overlay must be in the DOM with the real content rather than
       the SettingsPageFallback skeleton. */
    await act(async () => {
      settingsButton!.click();
      /* Multiple microtask flushes to settle: dynamic import → Suspense
         resolve → React commit. */
      for (let i = 0; i < 5; i += 1) {
        await flushPromises();
      }
    });

    const overlay = host.querySelector('.settings-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay!.classList.contains('settings-overlay--loading')).toBe(false);
    expect(host.querySelector('[data-testid="settings-page-stub"]')).not.toBeNull();
    expect(host.textContent).toContain('settings-page-content');
  });
});
