import { showUpdateDot, updateRowMode } from './chrome-state.js';

export function mountUpdater({ setStatus }) {
  const updateBtn = document.getElementById('update-btn');
  const updateLabel = document.getElementById('update-label');
  const updateRetry = document.getElementById('update-retry');
  const updateDot = document.getElementById('update-dot');
  const updateDialog = document.getElementById('update-dialog');
  const updateDialogTitle = document.getElementById('update-dialog-title');
  const updateDialogBody = document.getElementById('update-dialog-body');
  const updateLater = document.getElementById('update-later');
  const updateConfirm = document.getElementById('update-confirm');

  let updateState = null;
  let updaterOwnsStatus = false;

  function versionLabel(version) {
    return version ? `v${version}` : '新版本';
  }

  function isMacUpdate(payload) {
    return payload && payload.platformFlow === 'mac-dmg';
  }

  function fillUpdateDialog(payload) {
    const version = versionLabel(payload.availableVersion);
    const downloading = payload.status === 'downloading';
    const opening = payload.status === 'installing';
    if (isMacUpdate(payload)) {
      updateDialogTitle.textContent = '下载新版本？';
      updateDialogBody.textContent = downloading
        ? `正在下载 ${version} 的安装包，完成后会自动打开。`
        : opening
          ? `正在打开 ${version} 的安装包。请将应用拖入「应用程序」完成更新。`
          : `将下载 ${version} 的安装包（dmg），完成后会自动打开，需手动将应用拖入「应用程序」完成更新。`;
      updateConfirm.textContent = downloading || opening ? '请稍候' : '下载新版本';
    } else {
      updateDialogTitle.textContent = '安装更新并重启？';
      updateDialogBody.textContent = `将关闭应用并安装 ${version}。`;
      updateConfirm.textContent = '立即重启并更新';
    }
    updateConfirm.disabled = downloading || opening;
  }

  function renderUpdate(payload) {
    if (!payload) return;
    const previous = updateState;
    updateState = payload;
    const row = updateRowMode(payload.status);
    const failed = payload.status === 'error';
    const ready = payload.status === 'readyToInstall';
    updateBtn.hidden = row !== 'install';
    updateRetry.hidden = row !== 'retry';
    updateDot.hidden = !showUpdateDot(payload.status);

    if (row === 'install') {
      const version = versionLabel(payload.availableVersion);
      const label = isMacUpdate(payload) ? `下载 ${version}` : `安装 ${version}`;
      updateLabel.textContent = label;
      updateBtn.setAttribute('aria-label', isMacUpdate(payload) ? '下载新版本' : '重启并安装更新');
    }

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

    if (updateDialog.open && (failed || (previous && previous.status === 'installing' && ready))) {
      updateDialog.close();
      return;
    }
    if (updateDialog.open) fillUpdateDialog(payload);
  }

  updateBtn.addEventListener('click', () => {
    if (!updateState || updateState.status !== 'readyToInstall') return;
    fillUpdateDialog(updateState);
    updateDialog.showModal();
  });

  updateLater.addEventListener('click', () => {
    updateDialog.close();
  });

  updateConfirm.addEventListener('click', async () => {
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
}
