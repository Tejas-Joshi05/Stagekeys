import type { MidiBus } from '../midi';
import { useSettings } from '../shared/settings';
import { PianoEngine } from './piano';

export { decayFor, midiToHz, PianoEngine, velocityGain } from './piano';

export interface PianoOptions {
  bus: MidiBus;
  /** Return false while this window should stay silent (the stage owns MIDI during a show). */
  isActive?: () => boolean;
}

/**
 * Plays notes from the MIDI bus when the piano is switched on in settings.
 * Subscribe after the mapping engine, so keys that trigger a mapping are
 * already marked and can stay silent. Returns a stop function.
 */
export function startPiano(options: PianoOptions): () => void {
  const engine = new PianoEngine(useSettings.getState().piano);
  engine.warm();
  const unsubscribeSettings = useSettings.subscribe((s, prev) => {
    if (s.piano !== prev.piano) engine.configure(s.piano);
  });
  const unsubscribeBus = options.bus.subscribe((message) => {
    if (options.isActive && !options.isActive()) return;
    const { piano, controller } = useSettings.getState();
    if (message.type === 'cc') {
      if (message.controller === 64) engine.setSustain(message.value >= 64);
      return;
    }
    if (message.type !== 'noteOn' && message.type !== 'noteOff') return;
    if (!piano.pads && message.channel === controller.padChannel) return;
    if (message.type === 'noteOn') {
      if (piano.skipMapped && message.consumed) return;
      engine.noteOn(message.note, message.velocity);
    } else {
      engine.noteOff(message.note);
    }
  });
  return () => {
    unsubscribeBus();
    unsubscribeSettings();
    engine.dispose();
  };
}
