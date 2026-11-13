import { midi } from './service';
import { ALL_DEVICES, useMidiStore } from './store';
import type { MidiStatus } from './types';

const STATUS_TEXT: Record<MidiStatus, string> = {
  starting: 'Starting MIDI…',
  connected: 'MIDI connected',
  'no-devices': 'No MIDI device',
  disconnected: 'MIDI disconnected',
  unavailable: 'MIDI unavailable',
};

export function midiStatusText(status: MidiStatus): string {
  return STATUS_TEXT[status];
}

export function MidiStatusBadge({ status, detail }: { status: MidiStatus; detail?: string }) {
  return (
    <span
      className={`midi-badge midi-${status}`}
      title={detail || STATUS_TEXT[status]}
      data-testid="midi-status"
    >
      <span className="midi-dot" />
      {STATUS_TEXT[status]}
    </span>
  );
}

export function DevicePicker() {
  const devices = useMidiStore((s) => s.devices);
  const selection = useMidiStore((s) => s.selection);
  const status = useMidiStore((s) => s.status);
  const detail = useMidiStore((s) => s.detail);
  const names = [...new Set(devices.map((d) => d.name))];
  const missing = selection !== ALL_DEVICES && !names.includes(selection);

  return (
    <div className="device-picker">
      <label className="field">
        <span>Input device</span>
        <select value={selection} onChange={(e) => midi.select(e.target.value)}>
          <option value={ALL_DEVICES}>All devices</option>
          {names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          {missing && <option value={selection}>{selection} (not connected)</option>}
        </select>
      </label>
      <MidiStatusBadge status={status} detail={detail} />
      {detail && <p className="hint">{detail}</p>}
    </div>
  );
}
