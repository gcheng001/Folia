// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPath, saveFile } from './fileService';
import type { OpenedFile } from '../types/document';

const tauriCoreMock = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

const tauriFsMock = vi.hoisted(() => ({
  readTextFile: vi.fn(),
  readFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => tauriCoreMock);

vi.mock('@tauri-apps/plugin-fs', () => tauriFsMock);

// 与 src-tauri/src/lib.rs 中 read_opened_document_bytes 的超限错误文案保持一致；
// 前端 fileService 用 OVERSIZED_FILE_PATTERN 匹配该串以决定是否弹原生提示。
// 修改 Rust 端文案时必须同步更新本常量与下面的匹配断言（ISS-159 契约守卫）。
const BACKEND_OVERSIZED_FILE_ERROR =
  'file too large: 12345678 bytes exceeds the 10485760 byte limit';

const dialogMock = vi.hoisted(() => ({
  message: vi.fn().mockResolvedValue(undefined),
  open: vi.fn(),
  save: vi.fn(),
}));

const settingsMock = vi.hoisted(() => ({
  getSettings: vi.fn(() => ({ locale: 'zh-CN' })),
}));

const i18nMock = vi.hoisted(() => ({
  translate: vi.fn((_locale: unknown, key: unknown) => `__tr:${String(key)}`),
}));

vi.mock('@tauri-apps/plugin-dialog', () => dialogMock);
vi.mock('./settingsService', () => settingsMock);
vi.mock('./i18n', () => i18nMock);

function bytesOf(value: string): number[] {
  return Array.from(new TextEncoder().encode(value));
}

// 后端 read_opened_document 现以 tauri::ipc::Response 返回原始字节，
// 前端 invoke 拿到的是 ArrayBuffer（ISS-159）。
function arrayBufferOf(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer;
}

describe('fileService', () => {
  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.clearAllMocks();
  });

  it('reads desktop-opened Markdown paths through the backend in Tauri runtime', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
    tauriCoreMock.invoke.mockResolvedValue(arrayBufferOf('# 双击打开\n正文'));
    tauriFsMock.readTextFile.mockRejectedValue(new Error('frontend fs scope denied'));

    const opened = await openPath('/Users/demo/双击打开.md', 'UTF-8');

    expect(tauriCoreMock.invoke).toHaveBeenCalledWith('read_opened_document', {
      path: '/Users/demo/双击打开.md',
    });
    expect(tauriFsMock.readTextFile).not.toHaveBeenCalled();
    expect(opened).toEqual({
      path: '/Users/demo/双击打开.md',
      name: '双击打开.md',
      content: '# 双击打开\n正文',
      dirty: false,
      lastSavedContent: '# 双击打开\n正文',
      fileType: 'markdown',
    });
  });

  it('still decodes legacy number-array responses for robustness', async () => {
    // 后端现已返回 ArrayBuffer；这里防御性地覆盖 number[] 旧形态仍能正确解码（ISS-159）。
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
    tauriCoreMock.invoke.mockResolvedValue(bytesOf('# legacy\n正文'));

    const opened = await openPath('/Users/demo/legacy.md', 'UTF-8');

    expect(opened.content).toBe('# legacy\n正文');
  });

  it('keeps browser/test fallback on the filesystem plugin outside Tauri runtime', async () => {
    tauriFsMock.readTextFile.mockResolvedValue('# 手动打开');

    const opened = await openPath('/tmp/manual.md', 'UTF-8');

    expect(tauriCoreMock.invoke).not.toHaveBeenCalled();
    expect(tauriFsMock.readTextFile).toHaveBeenCalledWith('/tmp/manual.md');
    expect(opened.content).toBe('# 手动打开');
  });

  it('saves existing Markdown files through the backend in Tauri runtime', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
    tauriCoreMock.invoke.mockResolvedValue(undefined);
    tauriFsMock.writeTextFile.mockRejectedValue(new Error('frontend fs scope denied'));
    const file: OpenedFile = {
      path: '/Users/demo/双击打开.md',
      name: '双击打开.md',
      content: '# 修改后',
      dirty: true,
      lastSavedContent: '# 修改前',
      fileType: 'markdown',
    };

    const saved = await saveFile(file);

    expect(tauriCoreMock.invoke).toHaveBeenCalledWith('write_opened_document', {
      path: '/Users/demo/双击打开.md',
      content: '# 修改后',
    });
    expect(tauriFsMock.writeTextFile).not.toHaveBeenCalled();
    expect(saved.dirty).toBe(false);
    expect(saved.lastSavedContent).toBe('# 修改后');
  });

  it('shows a native prompt when the backend rejects an oversized file', async () => {
    // 契约守卫：后端超限错误文案必须被前端 OVERSIZED_FILE_PATTERN 命中（ISS-159）。
    // 修改 lib.rs 文案时同步更新 BACKEND_OVERSIZED_FILE_ERROR，此断言即第一道防线。
    expect(/file too large/i.test(BACKEND_OVERSIZED_FILE_ERROR)).toBe(true);

    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    tauriCoreMock.invoke.mockRejectedValue(new Error(BACKEND_OVERSIZED_FILE_ERROR));

    await expect(openPath('/Users/demo/huge.md', 'UTF-8')).rejects.toThrow(BACKEND_OVERSIZED_FILE_ERROR);

    expect(settingsMock.getSettings).toHaveBeenCalledTimes(1);
    expect(i18nMock.translate).toHaveBeenCalledWith('zh-CN', 'openFileTooLargeMessage');
    expect(dialogMock.message).toHaveBeenCalledTimes(1);
    expect(dialogMock.message).toHaveBeenCalledWith('__tr:openFileTooLargeMessage', {
      title: 'huge.md',
      kind: 'warning',
    });
  });

  it('does not show the oversized prompt for unrelated read errors', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    tauriCoreMock.invoke.mockRejectedValue(new Error('failed to read document: permission denied'));

    await expect(openPath('/Users/demo/perm.md', 'UTF-8')).rejects.toThrow();

    expect(dialogMock.message).not.toHaveBeenCalled();
  });
});
