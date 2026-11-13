import { useEffect, useState } from 'react';
import type { MidiBus } from './bus';
import { describeMidi } from './parse';
import type { MidiMessage } from './types';

export interface MonitorLine {
  seq: number;
  text: string;
  device: string;
  channel: number;
  mapped: boolean;
}

export function toMonitorLine(m: MidiMessage): MonitorLine {
  return {
    seq: m.seq,
    text: describeMidi(m),
    device: m.device,
    channel: m.channel,
    mapped: m.consumed,
  };
}

const MAX_LINES = 40;
const POLL_MS = 100;

/** Polls the bus about ten times a second. MIDI never drives a render per message. */
export function useMonitorLines(bus: MidiBus): MonitorLine[] {
  const [lines, setLines] = useState<MonitorLine[]>([]);
  useEffect(() => {
    let lastSeq = -1;
    const timer = setInterval(() => {
      if (bus.head === lastSeq) return;
      lastSeq = bus.head;
      setLines(bus.recent(MAX_LINES).map(toMonitorLine).reverse());
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [bus]);
  return lines;
}

export function MidiMonitorView({ lines }: { lines: readonly MonitorLine[] }) {
  if (lines.length === 0) {
    return <div className="monitor monitor-empty">Play a key or move a knob to see it here.</div>;
  }
  return (
    <div className="monitor" data-testid="midi-monitor">
      {lines.map((line) => (
        <div key={line.seq} className={line.mapped ? 'monitor-line mapped' : 'monitor-line'}>
          <span className="monitor-text">{line.text}</span>
          <span className="monitor-meta">
            ch {line.channel} · {line.device}
          </span>
        </div>
      ))}
    </div>
  );
}

export function MidiMonitor({ bus }: { bus: MidiBus }) {
  return <MidiMonitorView lines={useMonitorLines(bus)} />;
}
