/** @type {Record<string, string>} */
const ANIMATION_URLS = {
  'plugin-boot': new URL('./plugin-boot.json', import.meta.url).href,
};

/** @type {Map<string, Promise<object>>} */
const dataCache = new Map();

/**
 * @param {string} name
 * @returns {Promise<object>}
 */
function loadAnimationData(name) {
  const url = ANIMATION_URLS[name];
  if (!url) return Promise.reject(new Error(`未知 Lottie 动画: ${name}`));
  let pending = dataCache.get(name);
  if (!pending) {
    pending = fetch(url).then(async (response) => {
      if (!response.ok) throw new Error(`无法加载 Lottie: ${name}`);
      return /** @type {object} */ (await response.json());
    });
    dataCache.set(name, pending);
  }
  return pending;
}

function lottieApi() {
  const api = typeof lottie !== 'undefined' ? lottie : window.lottie;
  if (!api || typeof api.loadAnimation !== 'function') {
    throw new Error('lottie-web 未加载');
  }
  return api;
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 在容器里按名字播放一段 Lottie。返回的 destroy 会停掉并清空容器。
 *
 * @param {string} name 登记在 ANIMATION_URLS 里的名字
 * @param {HTMLElement} container
 * @param {{ loop?: boolean }} [options]
 * @returns {Promise<{ destroy: () => void }>}
 */
export async function playLottie(name, container, options = {}) {
  const loop = options.loop !== false;
  const animationData = await loadAnimationData(name);
  const reduceMotion = prefersReducedMotion();
  container.replaceChildren();
  const animation = lottieApi().loadAnimation({
    container,
    renderer: 'svg',
    loop: reduceMotion ? false : loop,
    autoplay: !reduceMotion,
    animationData,
  });
  if (reduceMotion && typeof animation.goToAndStop === 'function') {
    animation.goToAndStop(0, true);
  }
  let alive = true;
  return {
    destroy() {
      if (!alive) return;
      alive = false;
      try {
        animation.destroy();
      } catch {
        // 容器已拆掉时 lottie 可能抛错。
      }
      container.replaceChildren();
    },
  };
}
