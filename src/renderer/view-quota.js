// 保活名额不依赖 Electron：渲染进程拿宿主读到的字节数（或「读不到」）来算该拆谁。
const GIB = 1024 ** 3;
const HARD_CAP = 5;

/** @param {number} bytes */
export function memoryAllowance(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return HARD_CAP;
  if (bytes >= 4 * GIB) return HARD_CAP;
  if (bytes >= 2 * GIB) return 3;
  return 1;
}

/**
 * @param {{
 *   residents: Array<{ id: string; lastHotAt: number }>;
 *   protectedId: string | null | undefined;
 *   availableBytes: number | undefined;
 * }} input
 */
export function selectEvictions({ residents, protectedId, availableBytes }) {
  const quota = Math.min(HARD_CAP, memoryAllowance(availableBytes));
  const overflow = residents.length - quota;
  if (overflow <= 0) return [];

  // 受保护的那一个本轮不拆。其余最久没成为热界面的先拆；时间相同则 id 字典序靠前的先拆。
  const ranked = residents.filter((resident) => resident.id !== protectedId);
  ranked.sort((a, b) => {
    if (a.lastHotAt !== b.lastHotAt) return a.lastHotAt < b.lastHotAt ? -1 : 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });

  /** @type {string[]} */
  const evict = [];
  for (const resident of ranked) {
    if (evict.length >= overflow) break;
    evict.push(resident.id);
  }
  return evict;
}
