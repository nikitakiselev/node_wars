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
});
