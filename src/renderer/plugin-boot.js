import { playLottie } from './lottie/player.js';

/** 打开后仍未就绪才显现，避免快启动插件闪一下。 */
const REVEAL_AFTER_MS = 300;

/**
 * 插件冷启动遮罩：盖在 #viewport-host 上，只播 plugin-boot 这一段。
 *
 * @param {HTMLElement} viewportHost
 */
export function mountPluginBoot(viewportHost) {
  const overlay = document.createElement('div');
  overlay.id = 'plugin-boot';
  overlay.hidden = true;
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-label', '正在打开插件');
  const stage = document.createElement('div');
  stage.className = 'plugin-boot-stage';
  overlay.appendChild(stage);
  viewportHost.appendChild(overlay);

  /** @type {string | null} */
  let activeId = null;
  /** @type {{ destroy: () => void } | null} */
  let playback = null;
  let playSeq = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let revealTimer = null;

  function clearRevealTimer() {
    if (revealTimer == null) return;
    clearTimeout(revealTimer);
    revealTimer = null;
  }

  function stopPlayback() {
    playSeq += 1;
    if (playback) {
      playback.destroy();
      playback = null;
    }
  }

  /**
   * @param {string} pluginId
   */
  function reveal(pluginId) {
    revealTimer = null;
    if (activeId !== pluginId) return;
    // 挂在最后，盖过后加的 webview。
    viewportHost.appendChild(overlay);
    overlay.hidden = false;
    const seq = ++playSeq;
    if (playback) {
      playback.destroy();
      playback = null;
    }
    void playLottie('plugin-boot', stage, { loop: true }).then((handle) => {
      if (seq !== playSeq) {
        handle.destroy();
        return;
      }
      playback = handle;
    }).catch(() => {
      // 动画失败时仍留白底，避免空白工作区。
    });
  }

  /**
   * @param {string} pluginId
   */
  function show(pluginId) {
    clearRevealTimer();
    stopPlayback();
    overlay.hidden = true;
    activeId = pluginId;
    revealTimer = setTimeout(() => reveal(pluginId), REVEAL_AFTER_MS);
  }

  /**
   * 收起遮罩。传入 pluginId 时，只有当前遮罩仍属于该插件才收。
   *
   * @param {string} [pluginId]
   */
  function hide(pluginId) {
    if (pluginId != null && activeId !== pluginId) return;
    clearRevealTimer();
    activeId = null;
    overlay.hidden = true;
    stopPlayback();
  }

  return { show, hide };
}
