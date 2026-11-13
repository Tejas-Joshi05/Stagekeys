export interface SlideTiming {
  index: number;
  name: string;
  /** Total time spent on this slide, across all visits, in ms. */
  ms: number;
  visits: number;
}

/**
 * Records how long each slide was on screen. Used by rehearsal mode to show
 * where a talk runs long. Pure: time is passed in.
 */
export class ShowTimeline {
  private readonly totals = new Map<number, { ms: number; visits: number }>();
  private current: { index: number; since: number } | null = null;
  private startedAt: number | null = null;

  enter(index: number, now: number): void {
    this.startedAt ??= now;
    this.leave(now);
    const entry = this.totals.get(index) ?? { ms: 0, visits: 0 };
    entry.visits += 1;
    this.totals.set(index, entry);
    this.current = { index, since: now };
  }

  private leave(now: number): void {
    if (!this.current) return;
    const entry = this.totals.get(this.current.index);
    if (entry) entry.ms += Math.max(0, now - this.current.since);
    this.current = null;
  }

  elapsed(now: number): number {
    return this.startedAt === null ? 0 : Math.max(0, now - this.startedAt);
  }

  /** Time on the slide currently showing, this visit. */
  currentSlideElapsed(now: number): number {
    return this.current ? Math.max(0, now - this.current.since) : 0;
  }

  /** Closes the timeline and returns per-slide totals in slide order. */
  finish(now: number, names: readonly string[]): { totalMs: number; slides: SlideTiming[] } {
    const totalMs = this.elapsed(now);
    this.leave(now);
    const slides = [...this.totals.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, t]) => ({ index, name: names[index] ?? '', ms: t.ms, visits: t.visits }));
    return { totalMs, slides };
  }
}
