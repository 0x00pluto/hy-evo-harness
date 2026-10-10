import { mountIcons } from './icons.js';

const SOURCE_LABEL = {
  bundled: '内置',
  dev: '开发',
  installed: '已安装',
};
const CATALOG_SOURCE = '插件中心';
const OTHER_CATEGORY = '其他';
const TOAST_MS = 4000;

export function mountPluginsPage({ shell, plugins, chrome }) {
  const search = document.getElementById('plugins-search');
  const marketSearch = document.getElementById('plugins-market-search');
  const searchToggle = document.getElementById('plugins-search-toggle');
  const list = document.getElementById('plugins-list');
  const statusEl = document.getElementById('plugins-status');
  const detail = document.getElementById('plugins-detail');
  const refreshBtn = document.getElementById('plugins-refresh');
  const addBtn = document.getElementById('plugins-add');
  const marketPane = document.getElementById('plugins-market');
  const marketList = document.getElementById('plugins-market-list');
  const marketEntry = document.getElementById('plugins-market-entry');
  const toast = document.getElementById('shell-toast');
  const toastIcon = document.getElementById('shell-toast-icon');
  const toastText = document.getElementById('shell-toast-text');
  const toastClose = document.getElementById('shell-toast-close');

  let busy = false;
  let busyId = null;
  let menuHost = null;
  let catalogPlugins = [];
  let updates = [];
  let marketError = '';
  let toastTimer = 0;

  function setStatus(message, kind) {
    statusEl.textContent = message || '';
    if (kind) statusEl.dataset.kind = kind;
    else delete statusEl.dataset.kind;
  }

  function showToast(message, kind) {
    toastIcon.replaceChildren();
    const icon = document.createElement('i');
    icon.dataset.lucide = kind === 'ok' ? 'circle-check' : 'circle-x';
    toastIcon.appendChild(icon);
    toastText.textContent = message;
    toast.dataset.kind = kind === 'ok' ? 'ok' : 'error';
    toast.hidden = false;
    mountIcons(toast);
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, TOAST_MS);
  }

  function hideToast() {
    window.clearTimeout(toastTimer);
    toast.hidden = true;
  }

  function sourceLabel(source) {
    return SOURCE_LABEL[source] || '内置';
  }

  function query() {
    return search.value.trim().toLowerCase();
  }

  function marketQuery() {
    return marketSearch.value.trim().toLowerCase();
  }

  function visiblePlugins() {
    const q = query();
    if (!q) return shell.plugins;
    return shell.plugins.filter((plugin) => plugin.displayName.toLowerCase().includes(q));
  }

  function localPlugin(id) {
    return shell.plugins.find((plugin) => plugin.id === id) || null;
  }

  function renderList(session) {
    const focus = session.pluginsFocus;
    const marketOn = focus == null;
    marketEntry.classList.toggle('active', marketOn);
    marketEntry.setAttribute('aria-current', marketOn ? 'true' : 'false');
    list.replaceChildren();
    const items = visiblePlugins();
    if (shell.plugins.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-nav';
      empty.textContent = '还没有插件';
      list.appendChild(empty);
      return;
    }
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-nav';
      empty.textContent = '没有结果';
      list.appendChild(empty);
      return;
    }
    for (const plugin of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nav-item plugin-row';
      const selected = plugin.id === focus;
      if (selected) button.classList.add('active');
      button.setAttribute('aria-current', selected ? 'true' : 'false');
      const copy = document.createElement('span');
      copy.className = 'plugin-row-copy';
      copy.appendChild(pluginMark(plugin, 'nav'));
      const title = document.createElement('span');
      title.className = 'nav-title';
      title.textContent = plugin.displayName;
      copy.appendChild(title);
      const meta = document.createElement('span');
      meta.className = 'nav-meta';
      meta.textContent = plugin.runtimeError
        ? '环境未就绪'
        : updates.some((item) => item.id === plugin.id)
          ? '可更新'
          : sourceLabel(plugin.source);
      button.append(copy, meta);
      button.addEventListener('click', () => {
        chrome.focusPlugin(plugin.id);
      });
      list.appendChild(button);
    }
    mountIcons(list);
  }

  function defaultGlyph() {
    const icon = document.createElement('i');
    icon.dataset.lucide = 'puzzle';
    return icon;
  }

  function pluginMark(plugin, kind) {
    const mark = document.createElement('span');
    mark.className = kind === 'detail'
      ? 'plugin-mark plugin-mark-detail'
      : kind === 'market'
        ? 'plugin-mark plugin-mark-market'
        : 'plugin-mark plugin-mark-nav';
    if (plugin.iconUrl) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = plugin.iconUrl;
      img.addEventListener('error', () => {
        img.replaceWith(defaultGlyph());
        mountIcons(mark);
      });
      mark.appendChild(img);
    } else {
      mark.appendChild(defaultGlyph());
    }
    return mark;
  }

  function clearFolderTips() {
    document.querySelectorAll('.plugin-folder-tip').forEach((node) => node.remove());
  }

  function placeFolderTip(button, tip) {
    tip.hidden = false;
    const anchor = button.getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    let top = anchor.top - 8 - box.height;
    if (top < 8) top = anchor.bottom + 8;
    let left = anchor.left + anchor.width / 2 - box.width / 2;
    const maxLeft = window.innerWidth - box.width - 8;
    left = Math.max(8, Math.min(left, maxLeft));
    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;
  }

  function folderButton(options) {
    const rootPath = typeof options === 'string' ? options : options.path;
    const label = typeof options === 'string' ? '' : (options.sourceLabel || '');
    const openable = typeof options === 'string' ? false : Boolean(options.openable);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'plugin-folder';
    button.setAttribute('aria-label', '插件目录');
    const icon = document.createElement('i');
    icon.dataset.lucide = 'folder';
    button.appendChild(icon);
    const tip = document.createElement('div');
    tip.className = 'plugin-folder-tip';
    tip.setAttribute('role', 'tooltip');
    if (label) {
      const source = document.createElement('div');
      source.textContent = label;
      const pathLine = document.createElement('div');
      pathLine.textContent = rootPath || '';
      tip.append(source, pathLine);
    } else {
      tip.textContent = rootPath;
    }
    tip.hidden = true;
    document.body.appendChild(tip);
    const show = () => placeFolderTip(button, tip);
    const hide = () => { tip.hidden = true; };
    button.addEventListener('pointerenter', show);
    button.addEventListener('pointerleave', hide);
    button.addEventListener('focus', show);
    button.addEventListener('blur', hide);
    if (openable && rootPath) {
      button.addEventListener('click', () => {
        void window.dex.openPluginFolder(rootPath);
      });
    }
    return button;
  }

  function closeMenu() {
    if (menuHost) {
      const menu = menuHost.querySelector('.plugin-menu');
      const button = menuHost.querySelector('.plugin-more');
      if (menu) menu.hidden = true;
      if (button) button.setAttribute('aria-expanded', 'false');
    }
    menuHost = null;
  }

  function placeMenu(button, menu) {
    menu.hidden = false;
    const anchor = button.getBoundingClientRect();
    const box = menu.getBoundingClientRect();
    let top = anchor.bottom + 4;
    if (top + box.height > window.innerHeight - 8) top = anchor.top - 4 - box.height;
    if (top < 8) top = 8;
    let left = anchor.right - box.width;
    const maxLeft = window.innerWidth - box.width - 8;
    left = Math.max(8, Math.min(left, maxLeft));
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
  }

  function menuItem(item) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    if (item.danger) button.className = 'danger';
    const icon = document.createElement('i');
    icon.dataset.lucide = item.icon;
    const label = document.createElement('span');
    label.textContent = item.label;
    button.append(icon, label);
    button.addEventListener('click', () => {
      closeMenu();
      item.run();
    });
    return button;
  }

  function moreMenu(items) {
    const moreWrap = document.createElement('div');
    moreWrap.className = 'plugin-more-wrap';
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'plugin-icon-btn plugin-more';
    more.setAttribute('aria-label', '更多');
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    const ellipsis = document.createElement('i');
    ellipsis.dataset.lucide = 'ellipsis';
    more.appendChild(ellipsis);
    const menu = document.createElement('div');
    menu.className = 'plugin-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    for (const item of items) menu.appendChild(menuItem(item));
    more.addEventListener('click', () => {
      const wasOpen = menuHost === moreWrap && !menu.hidden;
      closeMenu();
      if (wasOpen) return;
      placeMenu(more, menu);
      more.setAttribute('aria-expanded', 'true');
      menuHost = moreWrap;
    });
    moreWrap.append(more, menu);
    return moreWrap;
  }

  function infoRow(label, value) {
    const rowLabel = document.createElement('div');
    rowLabel.className = 'plugin-info-label';
    rowLabel.textContent = label;
    const rowValue = document.createElement('div');
    rowValue.className = 'plugin-info-value';
    if (typeof value === 'string') rowValue.textContent = value;
    else rowValue.appendChild(value);
    return [rowLabel, rowValue];
  }

  function linkButton(label, url) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'plugin-link';
    button.setAttribute('aria-label', `${label} ${url}`);
    const text = document.createElement('span');
    text.textContent = url;
    const icon = document.createElement('i');
    icon.dataset.lucide = 'external-link';
    button.append(text, icon);
    button.addEventListener('click', () => {
      void (async () => {
        try {
          const result = await window.dex.openExternal(url);
          if (!result || !result.ok) setStatus('无法打开链接', 'error');
        } catch {
          setStatus('无法打开链接', 'error');
        }
      })();
    });
    return button;
  }

  function renderDetail(plugin) {
    closeMenu();
    clearFolderTips();
    detail.replaceChildren();
    const head = document.createElement('div');
    head.className = 'plugin-detail-head';
    head.appendChild(pluginMark(plugin, 'detail'));

    const copy = document.createElement('div');
    copy.className = 'plugin-detail-copy';
    const nameRow = document.createElement('div');
    nameRow.className = 'plugin-detail-name-row';
    const name = document.createElement('h1');
    name.className = 'plugin-detail-name';
    name.textContent = plugin.displayName;
    nameRow.appendChild(name);
    if (plugin.rootPath) nameRow.appendChild(folderButton(plugin.rootPath));
    copy.appendChild(nameRow);
    if (plugin.description) {
      const description = document.createElement('p');
      description.className = 'plugin-description';
      description.textContent = plugin.description;
      copy.appendChild(description);
    }
    const titleRow = document.createElement('div');
    titleRow.className = 'plugin-detail-title-row';
    titleRow.appendChild(copy);

    const actions = document.createElement('div');
    actions.className = 'plugin-detail-actions';
    if (plugin.source === 'installed') {
      actions.appendChild(moreMenu([
        {
          label: '卸载',
          icon: 'trash-2',
          danger: true,
          run: () => { void uninstallPlugin(plugin.id); },
        },
      ]));
    }

    const use = document.createElement('button');
    use.type = 'button';
    use.id = 'plugins-use';
    use.textContent = plugin.runtimeError ? '重试' : '立即使用';
    use.addEventListener('click', () => {
      if (plugin.runtimeError) {
        void retryRuntime(plugin.id);
        return;
      }
      void chrome.usePlugin(plugin.id);
    });
    if (updates.some((item) => item.id === plugin.id)) {
      const update = document.createElement('button');
      update.type = 'button';
      update.id = 'plugins-update';
      update.textContent = '更新';
      update.addEventListener('click', () => {
        void installFromCatalog(plugin.id, 'update');
      });
      actions.appendChild(update);
    }
    actions.appendChild(use);
    titleRow.appendChild(actions);
    head.appendChild(titleRow);
    detail.appendChild(head);

    if (plugin.runtimeError || plugin.catalogError) {
      const error = document.createElement('p');
      error.className = 'settings-error';
      error.textContent = plugin.runtimeError || plugin.catalogError;
      detail.appendChild(error);
    }

    const section = document.createElement('div');
    section.className = 'plugin-section-title';
    section.textContent = '信息';
    detail.appendChild(section);

    const table = document.createElement('div');
    table.className = 'plugin-info';
    const rows = [
      ['类型', plugin.type === 'ui' ? '界面' : '后台'],
      ['来源', sourceLabel(plugin.source)],
      ['版本', plugin.version],
    ];
    if (plugin.developer) rows.push(['开发者', plugin.developer]);
    if (plugin.category) rows.push(['分类', plugin.category]);
    for (const [label, value] of rows) {
      table.append(...infoRow(label, value));
    }
    const links = [
      ['网站', plugin.website],
      ['隐私政策', plugin.privacyPolicy],
      ['服务条款', plugin.termsOfService],
    ];
    for (const [label, url] of links) {
      if (!url) continue;
      table.append(...infoRow(label, linkButton(label, url)));
    }
    detail.appendChild(table);
    mountIcons(detail);
  }

  function sync(session) {
    const onPlugins = session.surface === 'plugins';
    if (!onPlugins) return;
    renderList(session);
    const plugin = session.pluginsFocus
      ? shell.plugins.find((item) => item.id === session.pluginsFocus)
      : null;
    if (plugin) {
      marketPane.hidden = true;
      detail.hidden = false;
      renderDetail(plugin);
      return;
    }
    if (session.pluginsFocus) {
      chrome.enterPlugins();
      return;
    }
    detail.hidden = true;
    detail.replaceChildren();
    marketPane.hidden = false;
    renderMarket();
  }

  function groupByCategory(items) {
    const groups = new Map();
    for (const item of items) {
      const category = item.category && item.category !== OTHER_CATEGORY ? item.category : OTHER_CATEGORY;
      const listForCategory = groups.get(category);
      if (listForCategory) listForCategory.push(item);
      else groups.set(category, [item]);
    }
    for (const listForCategory of groups.values()) {
      listForCategory.sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-CN'));
    }
    const names = Array.from(groups.keys()).filter((name) => name !== OTHER_CATEGORY);
    names.sort((left, right) => left.localeCompare(right, 'zh-CN'));
    if (groups.has(OTHER_CATEGORY)) names.push(OTHER_CATEGORY);
    return names.map((category) => ({ category, plugins: groups.get(category) }));
  }

  function renderMarket() {
    closeMenu();
    clearFolderTips();
    marketList.replaceChildren();
    if (marketError) {
      const error = document.createElement('p');
      error.className = 'settings-error';
      error.textContent = marketError;
      marketList.appendChild(error);
      return;
    }
    const q = marketQuery();
    const items = catalogPlugins.filter((plugin) => !q || plugin.displayName.toLowerCase().includes(q));
    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'settings-empty';
      empty.textContent = catalogPlugins.length === 0 ? '目录里还没有插件' : '没有结果';
      marketList.appendChild(empty);
      return;
    }
    for (const group of groupByCategory(items)) {
      const section = document.createElement('section');
      section.className = 'market-section';
      const heading = document.createElement('h2');
      heading.className = 'market-section-title';
      heading.textContent = group.category;
      const grid = document.createElement('div');
      grid.className = 'market-grid';
      for (const plugin of group.plugins) grid.appendChild(marketCard(plugin));
      section.append(heading, grid);
      marketList.appendChild(section);
    }
    mountIcons(marketList);
  }

  function marketCard(plugin) {
    const local = localPlugin(plugin.id);
    const card = document.createElement('article');
    card.className = 'market-card';
    const installing = busy && busyId === plugin.id;
    if (installing) card.classList.add('market-card-installing');
    const iconSource = { iconUrl: plugin.iconUrl || (local && local.iconUrl), displayName: plugin.displayName };
    card.appendChild(pluginMark(iconSource, 'market'));
    const copy = document.createElement('div');
    copy.className = 'market-copy';
    const nameRow = document.createElement('div');
    nameRow.className = 'market-name-row';
    const name = document.createElement('span');
    name.className = 'market-name';
    name.textContent = plugin.displayName;
    nameRow.appendChild(name);
    nameRow.appendChild(folderButton({
      path: local ? local.rootPath : plugin.installPath,
      sourceLabel: local ? sourceLabel(local.source) : CATALOG_SOURCE,
      openable: Boolean(local && local.rootPath),
    }));
    copy.appendChild(nameRow);
    if (plugin.description) {
      const description = document.createElement('p');
      description.className = 'market-description';
      description.textContent = plugin.description;
      copy.appendChild(description);
    }
    card.append(copy, marketAction(plugin, local, installing));
    return card;
  }

  function marketAction(plugin, local, installing) {
    if (installing) {
      const wrap = document.createElement('div');
      wrap.className = 'market-installing-label';
      const ring = document.createElement('span');
      ring.className = 'market-spinner';
      ring.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.textContent = '正在安装';
      wrap.append(ring, text);
      return wrap;
    }
    if (local) return installedMenu(local);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'plugin-icon-btn';
    button.setAttribute('aria-label', `安装${plugin.displayName}`);
    button.disabled = busy;
    const icon = document.createElement('i');
    icon.dataset.lucide = 'plus';
    button.appendChild(icon);
    button.addEventListener('click', () => {
      void installFromCatalog(plugin.id, 'install');
    });
    return button;
  }

  function installedMenu(local) {
    const items = [
      { label: '立即使用', icon: 'play', run: () => { void chrome.usePlugin(local.id); } },
      { label: '详情', icon: 'info', run: () => { chrome.focusPlugin(local.id); } },
    ];
    if (local.source === 'installed' && updates.some((item) => item.id === local.id)) {
      items.push({
        label: '更新',
        icon: 'refresh-cw',
        run: () => { void installFromCatalog(local.id, 'update'); },
      });
    }
    if (local.source === 'installed') {
      items.push({
        label: '卸载',
        icon: 'trash-2',
        danger: true,
        run: () => { void uninstallPlugin(local.id); },
      });
    }
    return moreMenu(items);
  }

  async function installFromCatalog(pluginId, kind) {
    if (busy) return;
    busy = true;
    busyId = pluginId;
    addBtn.disabled = true;
    try {
      chrome.enterPlugins();
      const result = await window.dex.installCatalogPlugin(pluginId);
      await finishInstall(result, kind);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '安装失败', 'error');
    } finally {
      busy = false;
      busyId = null;
      addBtn.disabled = false;
      const session = chrome.session();
      if (session && session.surface === 'plugins') sync(session);
      await refreshCatalog();
    }
  }

  async function refreshCatalog() {
    try {
      const result = await window.dex.pluginCatalog();
      if (!result || !result.ok) {
        catalogPlugins = [];
        updates = [];
        marketError = (result && result.message) || '无法读取插件中心';
      } else {
        catalogPlugins = Array.isArray(result.plugins) ? result.plugins : [];
        updates = Array.isArray(result.updates) ? result.updates : [];
        marketError = '';
      }
    } catch (err) {
      catalogPlugins = [];
      updates = [];
      marketError = err instanceof Error ? err.message : '无法读取插件中心';
    }
    const session = chrome.session();
    if (session && session.surface === 'plugins') sync(session);
  }

  async function uninstallPlugin(pluginId) {
    const plugin = localPlugin(pluginId);
    const name = plugin ? plugin.displayName : pluginId;
    const result = await window.dex.uninstall(pluginId);
    if (!result.ok) {
      showToast(result.message || '卸载失败', 'error');
      await plugins.refresh(result.plugins);
      return;
    }
    if (shell.activeId === pluginId) shell.activeId = null;
    await plugins.refresh(result.plugins);
    showToast(`「${name}」已卸载`, 'ok');
    chrome.enterPlugins();
    await refreshCatalog();
  }

  async function finishInstall(result, kind) {
    if (result.cancelled) return;
    if (!result.ok) {
      showToast(result.message || '安装失败', 'error');
      if (result.plugins) await plugins.refresh(result.plugins);
      return;
    }
    await plugins.refresh(result.plugins);
    const installed = result.installedId ? localPlugin(result.installedId) : null;
    if (installed && installed.runtimeError) {
      showToast(installed.runtimeError, 'error');
      return;
    }
    const name = installed ? installed.displayName : '插件';
    showToast(kind === 'update' ? `「${name}」已更新` : `「${name}」已安装`, 'ok');
  }

  async function retryRuntime(pluginId) {
    setStatus('正在准备运行环境');
    try {
      const result = await window.dex.retryPluginRuntime(pluginId);
      if (!result.ok) {
        setStatus(result.message || '运行环境未就绪', 'error');
        if (result.plugins) await plugins.refresh(result.plugins);
        return;
      }
      setStatus('运行环境已就绪', 'ok');
      await plugins.refresh(result.plugins);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '运行环境未就绪', 'error');
    }
  }

  search.addEventListener('input', () => {
    const session = chrome.session();
    if (!session || session.surface !== 'plugins') return;
    renderList(session);
  });

  marketSearch.addEventListener('input', () => {
    const session = chrome.session();
    if (!session || session.surface !== 'plugins' || session.pluginsFocus) return;
    renderMarket();
  });

  searchToggle.addEventListener('click', () => {
    const willOpen = search.hidden;
    search.hidden = !willOpen;
    searchToggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    if (willOpen) search.focus();
  });

  refreshBtn.addEventListener('click', () => {
    void (async () => {
      await plugins.refresh();
      await refreshCatalog();
      const session = chrome.session();
      if (session && session.pluginsFocus && !shell.plugins.some((plugin) => plugin.id === session.pluginsFocus)) {
        chrome.enterPlugins();
      }
    })();
  });

  marketEntry.addEventListener('click', () => {
    chrome.enterPlugins();
  });

  if (window.dex.onRuntimeProgress) {
    window.dex.onRuntimeProgress((event) => {
      if (busy) return;
      if (event && event.phase === 'preparing') setStatus('正在准备运行环境');
    });
  }

  addBtn.addEventListener('click', () => {
    void (async () => {
      if (busy) return;
      busy = true;
      busyId = null;
      addBtn.disabled = true;
      const session = chrome.session();
      if (session && !session.pluginsFocus) renderMarket();
      try {
        const result = await window.dex.pickAndInstall();
        await finishInstall(result, 'install');
      } catch (err) {
        showToast(err instanceof Error ? err.message : '安装失败', 'error');
      } finally {
        busy = false;
        busyId = null;
        addBtn.disabled = false;
        const session = chrome.session();
        if (session && session.surface === 'plugins') sync(session);
        await refreshCatalog();
      }
    })();
  });

  toastClose.addEventListener('click', () => {
    hideToast();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuHost) closeMenu();
  });
  marketList.addEventListener('scroll', () => {
    if (menuHost) closeMenu();
  });
  detail.addEventListener('scroll', () => {
    if (menuHost) closeMenu();
  });
  window.addEventListener('resize', () => {
    if (menuHost) closeMenu();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!menuHost) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (menuHost.contains(target)) return;
    closeMenu();
  });

  return {
    sync,
    refreshCatalog,
    clearStatus() {
      setStatus('');
    },
  };
}
