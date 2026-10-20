/**
 * 导出/保存的 Tauri 对话与文件写入壳。
 *
 * 在 Tauri 桌面环境内走原生 save/write；浏览器 fallback 用 a[download] 兜底。
 * 这样脑图导出既能在 Tauri 内弹原生保存框（沿用项目 fileService 习惯），
 * 也能在纯 Web 预览下退化为浏览器下载。
 */
import { save as tauriSaveDialog } from '@tauri-apps/plugin-dialog';
import { writeFile as tauriWriteFileRaw } from '@tauri-apps/plugin-fs';

export interface SaveOptions {
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}

function isTauri(): boolean {
  try {
    return typeof globalThis !== 'undefined' && '__TAURI_INTERNALS__' in globalThis;
  } catch {
    return false;
  }
}

export async function save(options: SaveOptions): Promise<string | null> {
  if (isTauri()) {
    try {
      const path = await tauriSaveDialog({
        defaultPath: options.defaultPath,
        filters: options.filters,
      });
      return path ?? null;
    } catch (error) {
      // P1-7: Tauri save失败必须抛错
      throw new Error(`保存失败: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
  // 浏览器：返回建议文件名，让调用方走 downloadBlob
  return options.defaultPath ?? null;
}

export async function writeFile(path: string, contents: Uint8Array): Promise<void> {
  if (isTauri() && !looksLikeTempName(path)) {
    try {
      await tauriWriteFileRaw(path, contents);
      return;
    } catch (error) {
      // P1-7: Tauri write失败必须抛错
      throw new Error(`写入失败: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
  // P1-7: 浏览器fallback：只使用basename，绝不把绝对路径当下载文件名
  const filename = path.split('/').pop()!.split('\\').pop()!;
  // 复制 buffer 确保 ArrayBuffer（非 Shared）。
  const copy = new Uint8Array(contents);
  triggerBrowserDownload(new Blob([copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength)]), filename);
}

function looksLikeTempName(p: string): boolean {
  // 默认路径（如 "mindmap.png"）没目录分隔符 → 浏览器走 download
  return !p.includes('/') && !p.includes('\\');
}

function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
