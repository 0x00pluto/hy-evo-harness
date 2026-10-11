/** 点确认时：有进行中任务则不开始下载或打开。 */
export function canStartMacDmgInstall(hasTask: boolean): boolean {
  return !hasTask;
}

/**
 * shell.openPath 返回空字符串才算打开成功。
 * 打开失败，或退出前又出现任务，都不退出进程。
 */
export function shouldQuitAfterOpeningMacDmg(openResult: string, hasTask: boolean): boolean {
  return openResult === '' && !hasTask;
}
