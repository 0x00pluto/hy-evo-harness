import { showUpdateDot, updateRowMode } from './chrome-state.js';
import { byId } from './dom.js';

/**
 * @param {{ setStatus: (message: string, kind?: string) => void }} opts
 */
export function mountUpdater({ setStatus }) {
  const updateBtn = byId('update-btn', 'button');
  const updateLabel = byId('update-label', 'span');
  const updateRetry = byId('update-retry', 'button');
  const updateRail = byId('rail-update', 'button');
  const updateDialog = byId('update-dialog', 'dialog');
  const updateDialogTitle = byId('update-dialog-title', 'h2');
  const updateDialogBody = byId('update-dialog-body', 'p');
  const updateLater = byId('update-later', 'button');
  const updateConfirm = byId('update-confirm', 'button');
  const updateProgress = byId('update-progress', 'div');
  const updateProgressFill = byId('update-progress-fill', 'span');

  /** @type {UpdaterStatusPayload | null} */
  let updateState = null;
  let forceUpdateIcon = false;
  let previewDialog = false;
  /** @type {ReturnType<typeof setInterval> | null} */
  let previewTimer = null;
  let updaterOwnsStatus = false;
  /** @type {Set<(payload: UpdaterStatusPayload) => void>} */
  const statusListeners = new Set();

  /** @param {string | undefined} version */
  function versionLabel(version) {
    return version ? `v${version}` : '新版本';
  }

  /** @param {UpdaterStatusPayload | null | undefined} payload */
  function isMacUpdate(payload) {
    return Boolean(payload && payload.platformFlow === 'mac-dmg');
  }

  /** @param {UpdaterStatusPayload | null | undefined} payload */
  function knownPercent(payload) {
    const percent = payload && payload.progressPercent;
    if (typeof percent !== 'number' || !Number.isFinite(percent)) return null;
    return Math.max(0, Math.min(100, Math.round(percent)));
  }

  /** @param {UpdaterStatusPayload} payload */
  function showProgress(payload) {
    const downloading = payload.status === 'downloading';
    if (!downloading) {
      updateProgress.hidden = true;
      updateProgress.classList.remove('indeterminate');
      updateProgress.removeAttribute('aria-valuenow');
      updateProgressFill.style.width = '0';
      return;
    }
    updateProgress.hidden = false;
    updateProgress.setAttribute('role', 'progressbar');
    updateProgress.setAttribute('aria-valuemin', '0');
    updateProgress.setAttribute('aria-valuemax', '100');
    const percent = knownPercent(payload);
    const known = percent !== null;
    updateProgress.classList.toggle('indeterminate', !known);
    if (known) {
      updateProgress.setAttribute('aria-valuenow', String(percent));
      updateProgressFill.style.width = `${percent}%`;
    } else {
      updateProgress.removeAttribute('aria-valuenow');
      updateProgressFill.style.width = '';
    }
  }

  /** @param {UpdaterStatusPayload} payload */
  function fillUpdateDialog(payload) {
    const version = versionLabel(payload.availableVersion);
    const downloading = payload.status === 'downloading';
    const opening = payload.status === 'installing';
    if (isMacUpdate(payload)) {
      if (downloading) {
        const percent = knownPercent(payload);
        updateDialogTitle.textContent = '正在下载';
        updateDialogBody.textContent = percent === null ? '正在下载' : `${percent}%`;
      } else if (opening) {
        updateDialogTitle.textContent = '下载新版本？';
        updateDialogBody.textContent = `正在打开 ${version} 的安装包，随后应用会退出。`;
      } else {
        updateDialogTitle.textContent = '下载新版本？';
        updateDialogBody.textContent = `将下载 ${version} 的安装包（dmg）。打开后应用会退出，请将应用拖入「应用程序」完成更新。`;
      }
      updateConfirm.textContent = '下载新版本';
    } else if (downloading) {
      const percent = knownPercent(payload);
      updateDialogTitle.textContent = '正在下载';
      updateDialogBody.textContent = percent === null ? '正在下载' : `${percent}%`;
      updateConfirm.textContent = '立即重启并更新';
    } else {
      updateDialogTitle.textContent = '安装更新并重启？';
      updateDialogBody.textContent = `将关闭应用并安装 ${version}。`;
      updateConfirm.textContent = '立即重启并更新';
    }
    updateConfirm.hidden = downloading || opening;
    updateConfirm.disabled = false;
    showProgress(payload);
  }

  function stopPreviewProgress() {
    if (previewTimer == null) return;
    clearInterval(previewTimer);
    previewTimer = null;
  }

  function startPreviewProgress() {
    stopPreviewProgress();
    let percent = 0;
    fillUpdateDialog({ ...previewPayload('downloading'), progressPercent: 0 });
    previewTimer = setInterval(() => {
      if (!previewDialog) {
        stopPreviewProgress();
        return;
      }
      percent = Math.min(100, percent + 2);
      fillUpdateDialog({ ...previewPayload('downloading'), progressPercent: percent });
      if (percent < 100) return;
      stopPreviewProgress();
      updateDialogBody.textContent = '预览完成，没有下载';
    }, 50);
  }

  /** @param {UpdateStatus} [status] */
  function previewPayload(status = 'readyToInstall') {
    return {
      status,
      availableVersion: '0.0.0',
      currentVersion: updateState?.currentVersion || '',
      platformFlow: /** @type {'win-auto' | 'mac-dmg'} */ (
        updateState && updateState.platformFlow ? updateState.platformFlow : 'mac-dmg'
      ),
    };
  }

  function syncUpdateChrome() {
    const row = updateState ? updateRowMode(updateState.status) : 'hidden';
    const ready = updateState ? showUpdateDot(updateState.status) : false;
    const showPreviewRow = forceUpdateIcon && row !== 'install' && row !== 'retry';
    updateBtn.hidden = row !== 'install' && !showPreviewRow;
    updateRetry.hidden = row !== 'retry';
    updateRail.hidden = !(ready || forceUpdateIcon);

    if (row === 'install' && updateState) {
      const version = versionLabel(updateState.availableVersion);
      const label = isMacUpdate(updateState) ? `下载 ${version}` : `安装 ${version}`;
      updateLabel.textContent = label;
      updateBtn.setAttribute('aria-label', isMacUpdate(updateState) ? '下载新版本' : '重启并安装更新');
      return;
    }

    if (!showPreviewRow) return;
    const preview = previewPayload();
    const label = isMacUpdate(preview) ? '下载 v0.0.0' : '安装 v0.0.0';
    updateLabel.textContent = label;
    updateBtn.setAttribute('aria-label', isMacUpdate(preview) ? '下载新版本' : '重启并安装更新');
  }

  /** @param {UpdaterStatusPayload | null | undefined} payload */
  function renderUpdate(payload) {
    if (!payload) return;
    const previous = updateState;
    updateState = payload;
    const failed = payload.status === 'error';
    const ready = payload.status === 'readyToInstall';
    if (ready) {
      previewDialog = false;
      stopPreviewProgress();
    }
    syncUpdateChrome();

    if (failed && payload.errorMessage) {
      setStatus(payload.errorMessage, 'error');
      updaterOwnsStatus = true;
    } else if (payload.status === 'downloading' && isMacUpdate(payload)) {
      setStatus('正在下载新版本…');
      updaterOwnsStatus = true;
    } else if (updaterOwnsStatus) {
      setStatus('');
      updaterOwnsStatus = false;
    }

    const keepPreview = previewDialog && updateDialog.open && !ready;
    const closeDialog = !keepPreview && updateDialog.open && (failed || (previous && previous.status === 'installing' && ready));
    if (closeDialog) updateDialog.close();
    else if (!keepPreview && updateDialog.open) fillUpdateDialog(payload);
    for (const listener of statusListeners) listener(payload);
  }

  function openInstallDialog() {
    if (!updateState) return;
    const status = updateState.status;
    if (status !== 'readyToInstall' && status !== 'downloading' && status !== 'installing') return;
    previewDialog = false;
    stopPreviewProgress();
    fillUpdateDialog(updateState);
    if (!updateDialog.open) updateDialog.showModal();
  }

  function openUpdateDialog() {
    if (updateState && updateState.status === 'readyToInstall') {
      previewDialog = false;
      fillUpdateDialog(updateState);
      updateDialog.showModal();
      return;
    }
    if (!forceUpdateIcon) return;
    previewDialog = true;
    fillUpdateDialog(previewPayload());
    updateDialog.showModal();
  }

  updateBtn.addEventListener('click', openUpdateDialog);
  updateRail.addEventListener('click', openUpdateDialog);

  updateLater.addEventListener('click', () => {
    previewDialog = false;
    stopPreviewProgress();
    updateDialog.close();
  });

  updateConfirm.addEventListener('click', async () => {
    if (previewDialog) {
      startPreviewProgress();
      return;
    }
    if (!updateState || updateConfirm.disabled) return;
    updateConfirm.disabled = true;
    try {
      const result = await window.dex.installUpdate();
      if (result && result.blockedByTask) {
        setStatus('请先结束当前任务，再安装更新', 'error');
        updaterOwnsStatus = true;
        updateDialog.close();
        return;
      }
      if (isMacUpdate(updateState)) return;
      updateDialog.close();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '安装更新失败', 'error');
      updaterOwnsStatus = true;
      updateDialog.close();
    }
  });

  updateRetry.addEventListener('click', () => {
    void window.dex.retryUpdateCheck();
  });

  window.dex.onUpdateStatus(renderUpdate);
  void window.dex.getUpdateStatus().then(renderUpdate).catch(() => {});
  void window.dex.devFlags().then((flags) => {
    forceUpdateIcon = Boolean(flags && flags.forceUpdateIcon);
    syncUpdateChrome();
  }).catch(() => {});

  return {
    status() {
      return updateState;
    },
    /** @param {(payload: UpdaterStatusPayload) => void} listener */
    onStatus(listener) {
      statusListeners.add(listener);
      if (updateState) listener(updateState);
      return () => statusListeners.delete(listener);
    },
    openInstallDialog,
  };
}
