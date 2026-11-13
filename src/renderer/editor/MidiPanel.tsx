import { useDeckStore } from '../deck';
import { DevicePicker, KeyboardDiagram, midi, MidiMonitor } from '../midi';
import { Section } from './fields';

/** Device choice, the live MIDI monitor, and (in development) a playable on-screen keyboard. */
export function MidiPanel({ virtualKeyboard }: { virtualKeyboard: boolean }) {
  const zones = useDeckStore((s) => s.deck?.zones);
  return (
    <div className="panel-scroll" data-testid="midi-panel">
      <Section title="Device">
        <DevicePicker />
      </Section>
      <Section title="Monitor">
        <MidiMonitor bus={midi.bus} />
      </Section>
      {virtualKeyboard && (
        <Section title="Virtual keyboard (development)">
          <KeyboardDiagram
            zones={zones}
            input={midi.input}
            from={48}
            to={84}
            onNote={(note, down) => midi.inject(down ? [0x90, note, 100] : [0x80, note, 0])}
          />
          <p className="hint">Click keys to send notes as if a keyboard were plugged in.</p>
        </Section>
      )}
    </div>
  );
}
