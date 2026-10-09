import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canCollapse,
  canGoBack,
  canGoForward,
  clearNavigation,
  createChromeSession,
  enterPlugins,
  enterSettings,
  goBack,
  goForward,
  selectPluginsFocus,
  showUpdateDot,
  togglePin,
  updateRowMode,
  splitWidthKey,
  usePlugin,
} from '../src/renderer/chrome-state.js';

test('cold start embeds the sidebar and disables both history directions', () => {
  const session = createChromeSession();
  assert.equal(session.pinned, true);
  assert.equal(session.surface, 'workspace');
  assert.equal(session.pluginsFocus, null);
  assert.equal(session.back, null);
  assert.equal(session.forward, null);
  assert.equal(canGoBack(session), false);
  assert.equal(canGoForward(session), false);
  assert.equal(canCollapse(session), true);
  assert.equal('mode' in session, false);
});

test('the collapse button toggles between embedded and floating', () => {
  const embedded = createChromeSession();
  const floating = togglePin(embedded);
  assert.equal(floating.pinned, false);
  assert.equal(floating.surface, 'workspace');
  assert.equal(togglePin(floating).pinned, true);
});

test('the collapse button does nothing while settings or plugins is open', () => {
  const settings = enterSettings(createChromeSession());
  assert.equal(canCollapse(settings), false);
  assert.equal(togglePin(settings), settings);

  const plugins = enterPlugins(createChromeSession());
  assert.equal(canCollapse(plugins), false);
  assert.equal(togglePin(plugins), plugins);
});

test('settings history is only back from settings and forward once', () => {
  const workspace = createChromeSession();
  assert.equal(goBack(workspace), workspace);
  assert.equal(goForward(workspace), workspace);

  const settings = enterSettings(workspace);
  assert.equal(settings.surface, 'settings');
  assert.equal(settings.pinned, true);
  assert.equal(canGoForward(settings), false);
  assert.equal(canGoBack(settings), true);
  assert.equal(enterSettings(settings), settings);
  assert.equal(goForward(settings), settings);

  const returned = goBack(settings);
  assert.equal(returned.surface, 'workspace');
  assert.equal(returned.pinned, true);
  assert.equal(returned.back, null);
  assert.deepEqual(returned.forward, { surface: 'settings' });
  assert.equal(canGoForward(returned), true);
  assert.equal(canGoBack(returned), false);

  const again = goForward(returned);
  assert.equal(again.surface, 'settings');
  assert.equal(again.forward, null);
  assert.deepEqual(goBack(again).forward, { surface: 'settings' });
});

test('leaving settings keeps the sidebar embedded or floating', () => {
  const embedded = goBack(enterSettings(createChromeSession()));
  assert.equal(embedded.pinned, true);
  assert.equal(embedded.surface, 'workspace');
  assert.equal(canGoForward(embedded), true);

  const floating = goBack(enterSettings(togglePin(createChromeSession())));
  assert.equal(floating.pinned, false);
  assert.equal(canGoForward(floating), true);
});

test('opening a plugin or installing clears forward', () => {
  const returned = goBack(enterSettings(createChromeSession()));
  const cleared = clearNavigation(returned);
  assert.equal(cleared.forward, null);
  assert.equal(cleared.back, null);
  assert.equal(clearNavigation(cleared), cleared);
});

test('toggling the pin also clears forward and the plugin-detail back target', () => {
  const returned = goBack(enterSettings(createChromeSession()));
  const floating = togglePin(returned);
  assert.equal(floating.pinned, false);
  assert.equal(floating.forward, null);

  const used = usePlugin(enterPlugins(createChromeSession()), 'demo');
  const pinnedOff = togglePin(used);
  assert.equal(pinnedOff.back, null);
  assert.equal(canGoBack(pinnedOff), false);
});

test('entering settings clears a pending forward target', () => {
  const returned = goBack(enterSettings(createChromeSession()));
  assert.equal(enterSettings(returned).forward, null);
});

test('puzzle opens the install stage and a second click stays there', () => {
  const install = enterPlugins(createChromeSession());
  assert.equal(install.surface, 'plugins');
  assert.equal(install.pluginsFocus, null);
  assert.equal(install.back, null);
  assert.equal(install.forward, null);
  assert.equal(enterPlugins(install), install);

  const fromSettings = enterPlugins(enterSettings(createChromeSession()));
  assert.equal(fromSettings.surface, 'plugins');
  assert.equal(fromSettings.pluginsFocus, null);
  assert.equal(fromSettings.forward, null);
});

test('selecting a plugin keeps the page and back returns to the workspace', () => {
  const detail = selectPluginsFocus(enterPlugins(createChromeSession()), 'demo');
  assert.equal(detail.surface, 'plugins');
  assert.equal(detail.pluginsFocus, 'demo');
  const workspaceOnly = createChromeSession();
  assert.equal(selectPluginsFocus(workspaceOnly, 'demo'), workspaceOnly);

  const workspace = goBack(detail);
  assert.equal(workspace.surface, 'workspace');
  assert.equal(workspace.back, null);
  assert.deepEqual(workspace.forward, { surface: 'plugins', pluginsFocus: 'demo' });

  const restored = goForward(workspace);
  assert.equal(restored.surface, 'plugins');
  assert.equal(restored.pluginsFocus, 'demo');
  assert.equal(restored.forward, null);
});

test('using a plugin then going back opens that detail and disables forward', () => {
  const detail = selectPluginsFocus(enterPlugins(createChromeSession()), 'demo');
  const using = usePlugin(detail, 'demo');
  assert.equal(using.surface, 'workspace');
  assert.deepEqual(using.back, { pluginId: 'demo' });
  assert.equal(using.forward, null);
  assert.equal(canGoForward(using), false);
  assert.equal(canGoBack(using), true);

  const returned = goBack(using);
  assert.equal(returned.surface, 'plugins');
  assert.equal(returned.pluginsFocus, 'demo');
  assert.equal(returned.back, null);
  assert.equal(returned.forward, null);
  assert.equal(canGoForward(returned), false);
});

test('opening another plugin clears the detail back target', () => {
  const using = usePlugin(enterPlugins(createChromeSession()), 'demo');
  const cleared = clearNavigation(using);
  assert.equal(cleared.surface, 'workspace');
  assert.equal(cleared.back, null);
  assert.equal(cleared.forward, null);
  assert.equal(goBack(cleared), cleared);
});

test('settings opened from the plugins page goes back to the workspace', () => {
  const detail = selectPluginsFocus(enterPlugins(createChromeSession()), 'demo');
  const settings = enterSettings(detail);
  assert.equal(settings.surface, 'settings');
  assert.equal(settings.pluginsFocus, null);
  assert.equal(settings.back, null);
  assert.equal(settings.forward, null);

  const workspace = goBack(settings);
  assert.equal(workspace.surface, 'workspace');
  assert.deepEqual(workspace.forward, { surface: 'settings' });
  assert.equal(workspace.pluginsFocus, null);
});

test('the plugins title and a second puzzle click return to the install stage', () => {
  const detail = selectPluginsFocus(enterPlugins(createChromeSession()), 'demo');
  const install = enterPlugins(detail);
  assert.equal(install.surface, 'plugins');
  assert.equal(install.pluginsFocus, null);
});

test('settings and plugins keep separate split width keys', () => {
  assert.equal(splitWidthKey('settings'), 'dex.settingsNavWidth');
  assert.equal(splitWidthKey('plugins'), 'dex.pluginsNavWidth');
  assert.equal(splitWidthKey('workspace'), null);
});

test('the update dot appears only when an update is ready to install', () => {
  const quiet = ['idle', 'checking', 'downloading', 'installing', 'upToDate', 'error'];
  for (const status of quiet) {
    assert.equal(showUpdateDot(status), false, status);
  }
  assert.equal(showUpdateDot('readyToInstall'), true);
});

test('the popover update row is install, retry, or hidden', () => {
  assert.equal(updateRowMode('readyToInstall'), 'install');
  assert.equal(updateRowMode('error'), 'retry');
  for (const status of ['idle', 'checking', 'downloading', 'installing', 'upToDate']) {
    assert.equal(updateRowMode(status), 'hidden', status);
  }
});
