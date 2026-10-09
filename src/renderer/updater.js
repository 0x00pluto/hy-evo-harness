import { showUpdateDot, updateRowMode } from './chrome-state.js';

export function mountUpdater({ setStatus }) {
  const updateBtn = document.getElementById('update-btn');
  const updateLabel = document.getElementById('update-label');
  const updateRetry = document.getElementById('update-retry');
  const updateRail = document.getElementById('rail-update');
  const updateDialog = document.getElementById('update-dialog');
  const updateDialogTitle = document.getElementById('update-dialog-title');
  const updateDialogBody = document.getElementById('update-dialog-body');
  const updateLater = document.getElementById('update-later');
  const updateConfirm = document.getElementById('update-confirm');
  const updateProgress = document.getElementById('update-progress');
  const updateProgressFill = document.getElementById('update-progress-fill');

  let updateState = null;
  let forceUpdateIcon = false;
  let previewDialog = false;
  let previewTimer = null;
  let updaterOwnsStatus = false;

  function versionLabel(version) {
    return version ? `v${version}` : '新版本';
  }

  function isMacUpdate(payload) {
    return payload && payload.platformFlow === 'mac-dmg';
  }

  function knownPercent(payload) {
    const percent = payload && payload.progressPercent;
    if (typeof percent !== 'number' || !Number.isFinite(percent)) return null;
    return Math.max(0, Math.min(100, Math.round(percent)));
  }

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
        updateDialogBody.textContent = `正在打开 ${version} 的安装包。请将应用拖入「应用程序」完成更新。`;
      } else {
        updateDialogTitle.textContent = '下载新版本？';
        updateDialogBody.textContent = `将下载 ${version} 的安装包（dmg），完成后会自动打开，需手动将应用拖入「应用程序」完成更新。`;
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

  function previewPayload(status = 'readyToInstall') {
    return {
      status,
      availableVersion: '0.0.0',
      platformFlow: updateState && updateState.platformFlow ? updateState.platformFlow : 'mac-dmg',
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

    if (previewDialog && updateDialog.open && !ready) return;

    if (updateDialog.open && (failed || (previous && previous.status === 'installing' && ready))) {
      updateDialog.close();
      return;
    }
    if (updateDialog.open) fillUpdateDialog(payload);
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
}
