// Electron 在 macOS 上把 free 报成 free pages，忙的时候会接近零。
// Chromium 的可用内存是 free（已去掉 speculative）加上可丢弃的 file-backed 缓存。
export type SystemMemorySnapshot = {
  free?: number;
  available?: number;
  fileBacked?: number;
};

export type AvailableMemoryResult = { ok: true; bytes: number } | { ok: false };

function kibToBytes(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value * 1024;
}

export function availableBytes(platform: string, info: SystemMemorySnapshot): number | null {
  if (platform === 'linux') return kibToBytes(info.available);
  if (platform === 'win32') return kibToBytes(info.free);
  if (platform === 'darwin') {
    const free = kibToBytes(info.free);
    const fileBacked = kibToBytes(info.fileBacked);
    if (free == null || fileBacked == null) return null;
    return free + fileBacked;
  }
  return null;
}

export function readAvailableMemory(
  platform: string,
  readInfo: () => SystemMemorySnapshot,
): AvailableMemoryResult {
  try {
    const bytes = availableBytes(platform, readInfo());
    if (bytes == null) return { ok: false };
    return { ok: true, bytes };
  } catch {
    return { ok: false };
  }
}
