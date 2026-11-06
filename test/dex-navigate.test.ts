import assert from 'node:assert/strict';
import test from 'node:test';
import { DexNavigateError, parseDexNavigate } from '../src/shared/dex-navigate.ts';

test('parseDexNavigate accepts settings/self', () => {
  assert.deepEqual(parseDexNavigate('dex://settings/self'), { kind: 'settings-self' });
});

test('parseDexNavigate accepts field fragment', () => {
  assert.deepEqual(parseDexNavigate('dex://settings/self#OPENAI_API_KEY'), {
    kind: 'settings-self',
    fieldKey: 'OPENAI_API_KEY',
  });
  assert.deepEqual(parseDexNavigate('dex://settings/self#A'), {
    kind: 'settings-self',
    fieldKey: 'A',
  });
  assert.deepEqual(parseDexNavigate('dex://settings/self#PLAYGROUND_NOTE'), {
    kind: 'settings-self',
    fieldKey: 'PLAYGROUND_NOTE',
  });
});

test('parseDexNavigate rejects empty and non-string', () => {
  for (const href of ['', '   ', null, undefined, 1]) {
    assert.throws(() => parseDexNavigate(href), (err: unknown) => {
      return err instanceof DexNavigateError && err.code === 'INVALID_HREF';
    });
  }
});

test('parseDexNavigate rejects other schemes and paths', () => {
  const bad = [
    'https://settings/self',
    'dexbuddy://settings/self',
    'dex://settings/other',
    'dex://settings/general',
    'dex://settings/self/extra',
    'dex://login/self',
    'dex://settings/',
    'dex://settings',
    'settings/self',
  ];
  for (const href of bad) {
    assert.throws(() => parseDexNavigate(href), (err: unknown) => {
      return err instanceof DexNavigateError && err.code === 'INVALID_HREF';
    });
  }
});

test('parseDexNavigate rejects query and bad field keys', () => {
  const bad = [
    'dex://settings/self?focus=OPENAI_API_KEY',
    'dex://settings/self#openai_api_key',
    'dex://settings/self#1ABC',
    'dex://settings/self#_FOO',
    'dex://settings/self#FOO-BAR',
  ];
  for (const href of bad) {
    assert.throws(() => parseDexNavigate(href), (err: unknown) => {
      return err instanceof DexNavigateError && err.code === 'INVALID_HREF';
    });
  }
});

test('parseDexNavigate treats bare hash as no field', () => {
  assert.deepEqual(parseDexNavigate('dex://settings/self#'), { kind: 'settings-self' });
});
