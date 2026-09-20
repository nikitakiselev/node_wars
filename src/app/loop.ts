/**
 * Fixed-timestep accumulator.
 *
 * The simulation must advance in equal slices so a match plays out the same
 * whatever the frame rate, while the renderer runs as fast as the display. The
 * leftover fraction is exposed as `alpha` so the renderer can interpolate
 * between the last two steps instead of showing the simulation's stutter.
 */
export class FixedTimestep {
  private accumulator = 0;

  constructor(
    private readonly stepSeconds: number,
    /** Cap on steps per frame, so a stalled tab does not try to catch up forever. */
    private readonly maxStepsPerFrame = 8,
  ) {}

  /** How far the clock sits between the last step and the next, in 0..1. */
  get alpha(): number {
    return this.accumulator / this.stepSeconds;
  }

  advance(deltaSeconds: number, step: (dt: number) => void): void {
    this.accumulator += deltaSeconds;

    let taken = 0;
    while (this.accumulator >= this.stepSeconds && taken < this.maxStepsPerFrame) {
      this.accumulator -= this.stepSeconds;
      taken++;
      step(this.stepSeconds);
    }

    if (this.accumulator >= this.stepSeconds) this.accumulator = 0;
  }
}
