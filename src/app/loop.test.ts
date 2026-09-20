import { describe, expect, test } from 'vitest';
import { FixedTimestep } from './loop';

describe('FixedTimestep', () => {
  test('runs one step once a full step of time has passed', () => {
    const clock = new FixedTimestep(0.1);
    const steps: number[] = [];

    clock.advance(0.1, (dt) => steps.push(dt));

    expect(steps).toEqual([0.1]);
  });

  test('runs nothing until a full step has accumulated', () => {
    const clock = new FixedTimestep(0.1);
    const steps: number[] = [];

    clock.advance(0.05, (dt) => steps.push(dt));

    expect(steps).toEqual([]);
  });

  test('carries the remainder into the next frame', () => {
    const clock = new FixedTimestep(0.1);
    const steps: number[] = [];

    clock.advance(0.07, (dt) => steps.push(dt));
    clock.advance(0.07, (dt) => steps.push(dt));

    expect(steps).toEqual([0.1]);
    expect(clock.alpha).toBeCloseTo(0.4);
  });

  test('catches up with several steps after a long frame', () => {
    const clock = new FixedTimestep(0.1);
    const steps: number[] = [];

    clock.advance(0.35, (dt) => steps.push(dt));

    expect(steps).toEqual([0.1, 0.1, 0.1]);
  });

  test('refuses to spiral after a huge stall, such as a backgrounded tab', () => {
    const clock = new FixedTimestep(0.1, 5);
    const steps: number[] = [];

    clock.advance(60, (dt) => steps.push(dt));

    expect(steps).toHaveLength(5);
  });

  test('reports how far it is between steps, for render interpolation', () => {
    const clock = new FixedTimestep(0.1);

    clock.advance(0.15, () => {});

    expect(clock.alpha).toBeCloseTo(0.5);
  });
});
