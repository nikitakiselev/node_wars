import { describe, expect, test } from 'vitest';
import { readOptions } from './options';

describe('readOptions', () => {
  test('the game pauses itself by default', () => {
    expect(readOptions('').autoPause).toBe(true);
    expect(readOptions('?seed=1').autoPause).toBe(true);
  });

  test('autopause=off keeps the game running when the window loses focus', () => {
    expect(readOptions('?autopause=off').autoPause).toBe(false);
  });

  test('accepts the other ways people write off', () => {
    for (const value of ['0', 'false', 'no', 'OFF']) {
      expect(readOptions(`?autopause=${value}`).autoPause, value).toBe(false);
    }
  });

  test('a bare flag is enough to turn it off', () => {
    expect(readOptions('?autopause').autoPause).toBe(false);
  });

  test('anything else leaves the default alone', () => {
    expect(readOptions('?autopause=on').autoPause).toBe(true);
    expect(readOptions('?autopause=yes').autoPause).toBe(true);
    expect(readOptions('?other=off').autoPause).toBe(true);
  });

  test('the device decides which controls to show unless told otherwise', () => {
    expect(readOptions('').controls).toBe('auto');
  });

  test('controls=touch puts the touch bar on a machine with a mouse', () => {
    // A desktop browser never reports a coarse pointer, so the phone layout
    // could not otherwise be looked at without a phone.
    expect(readOptions('?controls=touch').controls).toBe('touch');
    expect(readOptions('?controls=mouse').controls).toBe('mouse');
  });

  test('a controls value nobody recognises is ignored', () => {
    expect(readOptions('?controls=finger').controls).toBe('auto');
    expect(readOptions('?controls').controls).toBe('auto');
  });
});
