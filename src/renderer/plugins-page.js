import { mountIcons } from './icons.js';

const SOURCE_LABEL = {
  bundled: '内置',
  dev: '开发',
  installed: '已安装',
};

export function mountPluginsPage({ shell, plugins, chrome }) {
  const search = document.getElementById('plugins-search');
  const list = document.getElementById('plugins-list');
  const statusEl = document.getElementById('plugins-status');
  const installPane = document.getElementById('plugins-install');
  const dropZone = document.getElementById('plugins-drop');
  const detail = document.getElementById('plugins-detail');
  const refreshBtn = document.getElementById('plugins-refresh');
  const addBtn = document.getElementById('plugins-add');
  const marketPane = document.getElementById('plugins-market');
  const marketList = document.getElementById('plugins-market-list');
  const marketOpenBtn = document.getElementById('plugins-market-open');
  const marketBackBtn = document.getElementById('plugins-market-back');
  const marketRefreshBtn = document.getElementById('plugins-market-refresh');

  let installing = false;
  let dragDepth = 0;
  let menuOpen = false;
  let showMarket = false;
  let catalogPlugins = [];
  let updates = [];
  let marketError = '';

  function setStatus(message, kind) {
    statusEl.textContent = message || '';
    if (kind) statusEl.dataset.kind = kind;
    else delete statusEl.dataset.kind;
  }

  function sourceLabel(source) {
    return SOURCE_LABEL[source] || '内置';
  }

  function query() {
    return search.value.trim().toLowerCase();
  }

  function visiblePlugins() {
    const q = query();
    if (!q) return shell.plugins;
    return shell.plugins.filter((plugin) => plugin.displayName.toLowerCase().includes(q));
  }

  function renderList(session) {
    const focus = session.pluginsFocus;
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
      meta.textContent = updates.some((item) => item.id === plugin.id) ? '可更新' : sourceLabel(plugin.source);
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
    mark.className = kind === 'detail' ? 'plugin-mark plugin-mark-detail' : 'plugin-mark plugin-mark-nav';
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

  function folderButton(rootPath) {
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
    tip.textContent = rootPath;
    tip.hidden = true;
    document.body.appendChild(tip);
    const show = () => placeFolderTip(button, tip);
    const hide = () => { tip.hidden = true; };
    button.addEventListener('pointerenter', show);
    button.addEventListener('pointerleave', hide);
    button.addEventListener('focus', show);
    button.addEventListener('blur', hide);
    return button;
  }

  function closeMenu() {
    menuOpen = false;
    const menu = detail.querySelector('.plugin-menu');
    const button = detail.querySelector('.plugin-more');
    if (menu) menu.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
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
    clearFolderTips();
    detail.replaceChildren();
    menuOpen = false;
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
      const uninstall = document.createElement('button');
      uninstall.type = 'button';
      uninstall.setAttribute('role', 'menuitem');
      const trash = document.createElement('i');
      trash.dataset.lucide = 'trash-2';
      const uninstallLabel = document.createElement('span');
      uninstallLabel.textContent = '卸载';
      uninstall.append(trash, uninstallLabel);
      uninstall.addEventListener('click', () => {
        closeMenu();
        void uninstallPlugin(plugin.id);
      });
      menu.appendChild(uninstall);
      more.addEventListener('click', () => {
        menuOpen = !menuOpen;
        menu.hidden = !menuOpen;
        more.setAttribute('aria-expanded', menuOpen ? 'true' : 'false');
      });
      moreWrap.append(more, menu);
      actions.appendChild(moreWrap);
    }

    const use = document.createElement('button');
    use.type = 'button';
    use.id = 'plugins-use';
    use.textContent = '立即使用';
    use.addEventListener('click', () => {
      void chrome.usePlugin(plugin.id);
    });
    if (updates.some((item) => item.id === plugin.id)) {
      const update = document.createElement('button');
      update.type = 'button';
      update.id = 'plugins-update';
      update.textContent = '更新';
      update.addEventListener('click', () => {
        void runInstall(async () => {
          setStatus('正在下载…');
          const result = await window.dex.installCatalogPlugin(plugin.id);
          await finishInstall(result);
          await refreshCatalog();
        });
      });
      actions.appendChild(update);
    }
    actions.appendChild(use);
    titleRow.appendChild(actions);
    head.appendChild(titleRow);
    detail.appendChild(head);

    if (plugin.catalogError) {
      const error = document.createElement('p');
      error.className = 'settings-error';
      error.textContent = plugin.catalogError;
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
      installPane.hidden = true;
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
    clearFolderTips();
    detail.replaceChildren();
    installPane.hidden = showMarket;
    marketPane.hidden = !showMarket;
    if (showMarket) renderMarket();
  }

  function renderMarket() {
    marketList.replaceChildren();
    if (marketError) {
      const error = document.createElement('p');
      error.className = 'settings-error';
      error.textContent = marketError;
      marketList.appendChild(error);
      return;
    }
    const q = query();
    const items = catalogPlugins.filter((plugin) => !q || plugin.displayName.toLowerCase().includes(q));
    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'settings-empty';
      empty.textContent = catalogPlugins.length === 0 ? '目录里还没有插件' : '没有结果';
      marketList.appendChild(empty);
      return;
    }
    for (const plugin of items) {
      const row = document.createElement('div');
      row.className = 'market-row';
      const copy = document.createElement('div');
      copy.className = 'market-copy';
      const name = document.createElement('div');
      name.className = 'market-name';
      name.textContent = plugin.displayName;
      const meta = document.createElement('div');
      meta.className = 'market-meta';
      meta.textContent = plugin.description ? `${plugin.version} · ${plugin.description}` : plugin.version;
      copy.append(name, meta);
      row.append(copy, marketAction(plugin));
      marketList.appendChild(row);
    }
  }

  function marketAction(plugin) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'market-action';
    const local = shell.plugins.find((item) => item.id === plugin.id);
    const notice = updates.find((item) => item.id === plugin.id);
    if (local && local.source !== 'installed') {
      button.textContent = '不可覆盖';
      button.disabled = true;
      return button;
    }
    if (notice) {
      button.textContent = '更新';
      button.addEventListener('click', () => {
        void installFromCatalog(plugin.id);
      });
      return button;
    }
    if (local) {
      button.textContent = '已安装';
      button.disabled = true;
      return button;
    }
    button.textContent = '安装';
    button.addEventListener('click', () => {
      void installFromCatalog(plugin.id);
    });
    return button;
  }

  async function installFromCatalog(pluginId) {
    await runInstall(async () => {
      setStatus('正在下载…');
      const result = await window.dex.installCatalogPlugin(pluginId);
      await finishInstall(result);
      await refreshCatalog();
    });
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
    const result = await window.dex.uninstall(pluginId);
    if (!result.ok) {
      setStatus(result.message || '卸载失败', 'error');
      await plugins.refresh(result.plugins);
      return;
    }
    if (shell.activeId === pluginId) shell.activeId = null;
    setStatus('插件已卸载', 'ok');
    await plugins.refresh(result.plugins);
    chrome.enterPlugins();
  }

  async function finishInstall(result) {
    if (result.cancelled) return;
    if (!result.ok) {
      setStatus(result.message || '安装失败', 'error');
      if (result.plugins) await plugins.refresh(result.plugins);
      chrome.enterPlugins();
      return;
    }
    setStatus('插件已安装', 'ok');
    await plugins.refresh(result.plugins);
    if (result.installedId && shell.plugins.some((plugin) => plugin.id === result.installedId)) {
      chrome.focusPlugin(result.installedId);
    }
  }

  async function runInstall(task) {
    if (installing) return;
    installing = true;
    addBtn.disabled = true;
    try {
      await task();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '安装失败', 'error');
    } finally {
      installing = false;
      addBtn.disabled = false;
    }
  }

  search.addEventListener('input', () => {
    const session = chrome.session();
    if (!session || session.surface !== 'plugins') return;
    renderList(session);
    if (showMarket && !session.pluginsFocus) renderMarket();
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

  marketOpenBtn.addEventListener('click', () => {
    showMarket = true;
    void refreshCatalog();
  });

  marketBackBtn.addEventListener('click', () => {
    showMarket = false;
    const session = chrome.session();
    if (session) sync(session);
  });

  marketRefreshBtn.addEventListener('click', () => {
    void refreshCatalog();
  });

  addBtn.addEventListener('click', () => {
    void runInstall(async () => {
      const result = await window.dex.pickAndInstall();
      await finishInstall(result);
    });
  });

  installPane.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dragDepth += 1;
    dropZone.classList.add('dragover');
  });
  installPane.addEventListener('dragover', (event) => {
    event.preventDefault();
  });
  installPane.addEventListener('dragleave', () => {
    dragDepth -= 1;
    if (dragDepth <= 0) {
      dragDepth = 0;
      dropZone.classList.remove('dragover');
    }
  });
  installPane.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepth = 0;
    dropZone.classList.remove('dragover');
    if (installing) return;
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (!file) return;
    const zipPath = window.dex.pathForFile(file);
    void runInstall(async () => {
      if (!zipPath || !zipPath.toLowerCase().endsWith('.zip')) {
        setStatus('请拖入 .zip 插件包', 'error');
        return;
      }
      setStatus('正在安装…');
      const result = await plugins.installZip(zipPath);
      await finishInstall(result);
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuOpen) closeMenu();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!menuOpen) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (detail.contains(target) && target instanceof Element && target.closest('.plugin-more, .plugin-menu')) return;
    closeMenu();
  });

  return {
    sync,
    showInstallStage() {
      showMarket = false;
    },
    refreshCatalog,
    clearStatus() {
      setStatus('');
    },
  };
}
