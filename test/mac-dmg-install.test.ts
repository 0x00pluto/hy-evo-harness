import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canStartMacDmgInstall,
  shouldQuitAfterOpeningMacDmg,
} from '../src/main/mac-dmg-install.ts';

test('确认时有进行中任务则不开始', () => {
  assert.equal(canStartMacDmgInstall(true), false);
});

test('打开失败不退出', () => {
  assert.equal(shouldQuitAfterOpeningMacDmg('No application knows how to open', false), false);
});

test('打开成功且无任务则退出', () => {
  assert.equal(shouldQuitAfterOpeningMacDmg('', false), true);
});

test('打开成功但仍有任务则不退出', () => {
  assert.equal(shouldQuitAfterOpeningMacDmg('', true), false);
});
