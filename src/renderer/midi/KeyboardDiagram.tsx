import { useEffect, useRef } from 'react';
import { isBlackKey, noteName } from '../shared/util';
import type { MidiInputState } from './inputState';

export interface KeyboardZone {
  id: string;
  name: string;
  colour: string;
  fromNote: number;
  toNote: number;
}

interface Props {
  from?: number;
  to?: number;
  zones?: readonly KeyboardZone[];
  /** When given, held keys light up. Read on a timer, not through React state. */
  input?: MidiInputState;
  /** When given, the keys are playable with the mouse (the virtual keyboard). */
  onNote?: (note: number, down: boolean) => void;
}

const zoneFor = (zones: readonly KeyboardZone[], note: number): KeyboardZone | undefined =>
  zones.find(
    (z) => note >= Math.min(z.fromNote, z.toNote) && note <= Math.max(z.fromNote, z.toNote),
  );

/** A small piano keyboard: shows zones in colour, held keys, and can be played with the mouse. */
export function KeyboardDiagram({ from = 36, to = 96, zones = [], input, onNote }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const pressed = useRef<number | null>(null);

  useEffect(() => {
    if (!input) return;
    const timer = setInterval(() => {
      const el = root.current;
      if (!el) return;
      for (const key of el.querySelectorAll<HTMLElement>('[data-note]')) {
        key.classList.toggle('held', input.held.has(Number(key.dataset.note)));
      }
    }, 50);
    return () => clearInterval(timer);
  }, [input]);

  const release = () => {
    if (pressed.current !== null) {
      onNote?.(pressed.current, false);
      pressed.current = null;
    }
  };

  const whites: number[] = [];
  for (let n = from; n <= to; n++) if (!isBlackKey(n)) whites.push(n);
  const whiteWidth = 100 / whites.length;

  const keyProps = (note: number) => ({
    'data-note': note,
    title: `${noteName(note)} (${note})${zoneFor(zones, note) ? ` · ${zoneFor(zones, note)?.name}` : ''}`,
    onPointerDown: onNote
      ? (e: React.PointerEvent) => {
          e.preventDefault();
          release();
          pressed.current = note;
          onNote(note, true);
        }
      : undefined,
  });

  return (
    <div
      ref={root}
      className={onNote ? 'keyboard playable' : 'keyboard'}
      onPointerUp={release}
      onPointerLeave={release}
      data-testid="keyboard"
    >
      {whites.map((note, i) => {
        const zone = zoneFor(zones, note);
        return (
          <div
            key={note}
            className="key white"
            style={{
              left: `${i * whiteWidth}%`,
              width: `${whiteWidth}%`,
              background: zone ? `color-mix(in srgb, ${zone.colour} 55%, #f4f4f6)` : undefined,
            }}
            {...keyProps(note)}
          >
            {note % 12 === 0 && <span className="key-label">{noteName(note)}</span>}
          </div>
        );
      })}
      {whites.map((note, i) => {
        const black = note + 1;
        if (black > to || !isBlackKey(black)) return null;
        const zone = zoneFor(zones, black);
        return (
          <div
            key={black}
            className="key black"
            style={{
              left: `${(i + 1) * whiteWidth - whiteWidth * 0.3}%`,
              width: `${whiteWidth * 0.6}%`,
              background: zone ? `color-mix(in srgb, ${zone.colour} 70%, #17171c)` : undefined,
            }}
            {...keyProps(black)}
          />
        );
      })}
    </div>
  );
}
