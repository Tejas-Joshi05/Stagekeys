/**
 * Frame-rate and MIDI latency meter. Writes straight to a DOM node a couple
 * of times a second, so measuring never costs a React render.
 */
export class FrameMeter {
  private frames = 0;
  private windowStart = 0;
  private worstFrame = 0;
  private lastFrameAt = 0;
  private latencySum = 0;
  private latencyCount = 0;
  private latencyMax = 0;
  fps = 0;
  /** Average MIDI-to-frame latency over the last window, in ms (0 when no MIDI arrived). */
  latency = 0;
  private element: HTMLElement | null = null;

  attach(element: HTMLElement | null): void {
    this.element = element;
  }

  /** Records the delay between a MIDI message arriving and the frame that shows its effect. */
  midiLatency(ms: number): void {
    if (ms < 0 || ms > 2000) return;
    this.latencySum += ms;
    this.latencyCount += 1;
    this.latencyMax = Math.max(this.latencyMax, ms);
  }

  /** Call once per rendered frame. Returns a summary when a measurement window closes. */
  tick(
    now: number,
  ): { fps: number; worstFrameMs: number; latencyAvg: number; latencyMax: number } | null {
    if (this.lastFrameAt > 0) this.worstFrame = Math.max(this.worstFrame, now - this.lastFrameAt);
    this.lastFrameAt = now;
    this.frames += 1;
    if (this.windowStart === 0) this.windowStart = now;
    const elapsed = now - this.windowStart;
    if (elapsed < 500) return null;

    this.fps = (this.frames * 1000) / elapsed;
    const hadLatency = this.latencyCount > 0;
    this.latency = hadLatency ? this.latencySum / this.latencyCount : 0;
    const summary = {
      fps: this.fps,
      worstFrameMs: this.worstFrame,
      latencyAvg: this.latency,
      latencyMax: this.latencyMax,
    };
    if (this.element && !this.element.hidden) {
      this.element.textContent =
        `${this.fps.toFixed(0)} fps · worst ${this.worstFrame.toFixed(1)} ms` +
        (hadLatency
          ? ` · MIDI→frame ${this.latency.toFixed(1)} ms (max ${this.latencyMax.toFixed(1)})`
          : '');
    }
    this.frames = 0;
    this.windowStart = now;
    this.worstFrame = 0;
    this.latencySum = 0;
    this.latencyCount = 0;
    this.latencyMax = 0;
    return summary;
  }
}
