import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FOLDER_HOVER_TIP_CLEAR_SELECTOR,
  RAIL_UPDATE_TIP_TEXT,
  computeHoverTipPosition,
} from '../src/renderer/ui/hover-tip.js';

test('rail update tip text is fixed Chinese copy', () => {
  assert.equal(RAIL_UPDATE_TIP_TEXT, '有可用更新');
});

test('folder tip clear selector must not wipe persistent rail tips', () => {
  assert.equal(FOLDER_HOVER_TIP_CLEAR_SELECTOR, '.plugin-folder-tip');
  assert.equal(FOLDER_HOVER_TIP_CLEAR_SELECTOR.includes('.hover-tip'), false);
});

test('right placement sits 8px to the right and vertically centers', () => {
  const pos = computeHoverTipPosition(
    { top: 100, left: 10, width: 32, height: 32 },
    { width: 80, height: 28 },
    { width: 800, height: 600 },
    'right',
  );
  assert.equal(pos.left, 50);
  assert.equal(pos.top, 102);
});

test('right placement clamps inside the viewport', () => {
  const pos = computeHoverTipPosition(
    { top: 580, left: 740, width: 32, height: 32 },
    { width: 100, height: 40 },
    { width: 800, height: 600 },
    'right',
  );
  assert.equal(pos.left, 692);
  assert.equal(pos.top, 552);
});

test('top placement prefers above the anchor and flips when clipped', () => {
  const above = computeHoverTipPosition(
    { top: 120, left: 200, width: 24, height: 24 },
    { width: 100, height: 40 },
    { width: 800, height: 600 },
    'top',
  );
  assert.equal(above.top, 72);
  assert.equal(above.left, 162);

  const below = computeHoverTipPosition(
    { top: 20, left: 200, width: 24, height: 24 },
    { width: 100, height: 40 },
    { width: 800, height: 600 },
    'top',
  );
  assert.equal(below.top, 52);
});
