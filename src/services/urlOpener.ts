let cachedIsTauri: boolean | undefined;

async function isTauri(): Promise<boolean> {
  if (cachedIsTauri !== undefined) return cachedIsTauri;
  try {
    await import('@tauri-apps/api/core');
    cachedIsTauri = true;
  } catch {
    cachedIsTauri = false;
  }
  return cachedIsTauri;
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!url || typeof url !== 'string') return;
  if (await isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else {
    window.open(url, '_blank', 'noreferrer');
  }
}
