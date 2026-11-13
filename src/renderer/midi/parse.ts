import type { ParsedMidi } from './types';

/**
 * Parses one raw MIDI message. Returns null for anything that is not a
 * channel voice message we use (system messages, aftertouch, program change)
 * and for malformed data. Never throws.
 */
export function parseMidi(data: ArrayLike<number>): ParsedMidi | null {
  if (data.length < 2) return null;
  const status = data[0] ?? 0;
  if (status < 0x80 || status >= 0xf0) return null;
  const kind = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  const d1 = (data[1] ?? 0) & 0x7f;
  const d2 = (data[2] ?? 0) & 0x7f;

  switch (kind) {
    case 0x90:
      if (data.length < 3) return null;
      // Many keyboards send note-on with velocity 0 instead of note-off.
      return d2 === 0
        ? { type: 'noteOff', channel, note: d1, velocity: 0 }
        : { type: 'noteOn', channel, note: d1, velocity: d2 };
    case 0x80:
      if (data.length < 3) return null;
      return { type: 'noteOff', channel, note: d1, velocity: d2 };
    case 0xb0:
      if (data.length < 3) return null;
      return { type: 'cc', channel, controller: d1, value: d2 };
    case 0xe0: {
      if (data.length < 3) return null;
      const raw = (d2 << 7) | d1; // 0..16383, centre 8192
      const value = raw >= 8192 ? (raw - 8192) / 8191 : (raw - 8192) / 8192;
      return { type: 'pitchBend', channel, value };
    }
    default:
      return null;
  }
}

export function describeMidi(m: ParsedMidi): string {
  switch (m.type) {
    case 'noteOn':
      return `Note on  ${m.note} vel ${m.velocity}`;
    case 'noteOff':
      return `Note off ${m.note}`;
    case 'cc':
      return m.controller === 64
        ? `Sustain ${m.value >= 64 ? 'down' : 'up'} (${m.value})`
        : `CC ${m.controller} = ${m.value}`;
    case 'pitchBend':
      return `Pitch bend ${m.value.toFixed(2)}`;
  }
}
