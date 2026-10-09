import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canCollapse,
  canGoBack,
  clearForward,
  createChromeSession,
  enterSettings,
  goBack,
  goForward,
  showUpdateDot,
  togglePin,
  updateRowMode,
} from '../src/renderer/chrome-state.js';

test('cold start embeds the sidebar and disables both history directions', () => {
  const session = createChromeSession();
  assert.equal(session.pinned, true);
  assert.equal(session.surface, 'workspace');
  assert.equal(session.canForward, false);
  assert.equal(canGoBack(session), false);
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

test('the collapse button does nothing while settings is open', () => {
  const settings = enterSettings(createChromeSession());
  assert.equal(canCollapse(settings), false);
  assert.equal(togglePin(settings), settings);
});

test('settings history is only back from settings and forward once', () => {
  const workspace = createChromeSession();
  assert.equal(goBack(workspace), workspace);
  assert.equal(goForward(workspace), workspace);

  const settings = enterSettings(workspace);
  assert.equal(settings.surface, 'settings');
  assert.equal(settings.pinned, true);
  assert.equal(settings.canForward, false);
  assert.equal(canGoBack(settings), true);
  assert.equal(enterSettings(settings), settings);
  assert.equal(goForward(settings), settings);

  const returned = goBack(settings);
  assert.equal(returned.surface, 'workspace');
  assert.equal(returned.pinned, true);
  assert.equal(returned.canForward, true);
  assert.equal(canGoBack(returned), false);

  const again = goForward(returned);
  assert.equal(again.surface, 'settings');
  assert.equal(again.canForward, false);
  assert.equal(goBack(again).canForward, true);
});

test('leaving settings keeps the sidebar embedded or floating', () => {
  const embedded = goBack(enterSettings(createChromeSession()));
  assert.equal(embedded.pinned, true);
  assert.equal(embedded.surface, 'workspace');
  assert.equal(embedded.canForward, true);

  const floating = goBack(enterSettings(togglePin(createChromeSession())));
  assert.equal(floating.pinned, false);
  assert.equal(floating.canForward, true);
});

test('opening a plugin or installing clears forward', () => {
  const returned = goBack(enterSettings(createChromeSession()));
  const cleared = clearForward(returned);
  assert.equal(cleared.canForward, false);
  assert.equal(clearForward(cleared), cleared);
});

test('toggling the pin also clears forward', () => {
  const returned = goBack(enterSettings(createChromeSession()));
  const floating = togglePin(returned);
  assert.equal(floating.pinned, false);
  assert.equal(floating.canForward, false);
});

test('entering settings clears a pending forward target', () => {
  const returned = goBack(enterSettings(createChromeSession()));
  assert.equal(enterSettings(returned).canForward, false);
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
