import { useEffect, useRef } from 'react';
import type { ControllerProfile } from '../../ipc/settings';
import { keyLayout, MOD_CC, type ControlRef, type MidiInputState } from '../midi';
import { noteName } from '../shared/util';

/** A stable string for a control, for lookups and React keys. */
export function controlKey(ref: ControlRef): string {
  switch (ref.kind) {
    case 'key':
      return `key:${ref.note}`;
    case 'pad':
      return `pad:${ref.index}`;
    case 'knob':
      return `knob:${ref.index}`;
    case 'cc':
      return `cc:${ref.cc}`;
    default:
      return ref.kind;
  }
}

export interface ControlMark {
  /** Short text shown on hover. */
  title: string;
  /** Mapped only on this slide (drawn differently from deck-wide). */
  slideOnly: boolean;
}

interface Props {
  profile: ControllerProfile;
  low: number;
  selected: ControlRef | null;
  marks: ReadonlyMap<string, ControlMark>;
  /** Keys covered by range mappings (not one key each), drawn as an underline. */
  ranges: readonly { from: number; to: number }[];
  input: MidiInputState;
  onSelect: (ref: ControlRef) => void;
}

const W = 320;
const KEYS_Y = 94;
const KEYS_H = 70;

/**
 * The MPK mini IV, drawn to scale-ish: wheels, 8 pads, 8 knobs, 25 keys.
 * Click a control to choose it. Mapped controls carry a leaf-green mark; the
 * chosen one gets the rose, off-register outline. Live MIDI lights the
 * controls through a timer that touches the DOM directly, never React state.
 */
export function ControllerMap({ profile, low, selected, marks, ranges, input, onSelect }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const selectedKey = selected ? controlKey(selected) : '';

  useEffect(() => {
    let last = -1;
    const timer = setInterval(() => {
      const root = svg.current;
      if (!root || input.version === last) return;
      last = input.version;
      for (const el of root.querySelectorAll<SVGElement>('[data-live]')) {
        const [kind, raw] = (el.dataset.live ?? '').split(':');
        const n = Number(raw);
        let on = false;
        let amount = 0;
        if (kind === 'key')
          on = input.held.has(n) && input.heldChannel.get(n) !== profile.padChannel;
        else if (kind === 'pad') {
          const note = profile.padNotes[n] ?? -1;
          on = input.held.has(note) && input.heldChannel.get(note) === profile.padChannel;
        } else if (kind === 'knob') amount = (input.cc[profile.knobCCs[n] ?? 0] ?? 0) / 127;
        else if (kind === 'mod') amount = (input.cc[MOD_CC] ?? 0) / 127;
        else if (kind === 'pitch') amount = input.pitchBend;
        else if (kind === 'sustain') on = input.sustain;
        if (kind === 'knob') {
          el.setAttribute('transform', `rotate(${-135 + 270 * amount})`);
        } else if (kind === 'mod') {
          el.setAttribute('height', String(52 * amount));
          el.setAttribute('y', String(16 + 52 * (1 - amount)));
        } else if (kind === 'pitch') {
          el.setAttribute('y', String(40 - amount * 22));
        } else {
          el.classList.toggle('live', on);
        }
      }
    }, 50);
    return () => clearInterval(timer);
  }, [input, profile]);

  const choose = (ref: ControlRef) => (e: React.MouseEvent) => {
    e.preventDefault();
    onSelect(ref);
  };
  const cls = (ref: ControlRef, base: string): string => {
    const key = controlKey(ref);
    const mark = marks.get(key);
    return [
      base,
      mark ? (mark.slideOnly ? 'mapped slide-only' : 'mapped') : '',
      key === selectedKey ? 'chosen' : '',
    ]
      .filter(Boolean)
      .join(' ');
  };
  const tip = (ref: ControlRef, name: string): string => {
    const mark = marks.get(controlKey(ref));
    return mark ? `${name}: ${mark.title}` : `${name}: not mapped`;
  };

  const { whites, blacks } = keyLayout(low);
  const kw = (W - 16) / whites.length;
  const whiteX = new Map(whites.map((n, i) => [n, 8 + i * kw]));

  return (
    <svg
      ref={svg}
      className="controller-map"
      viewBox={`0 0 ${W} 172`}
      role="group"
      aria-label="MPK mini IV controls"
      data-testid="controller-map"
    >
      <rect className="cm-body" x="0.5" y="0.5" width={W - 1} height="171" rx="12" />

      {/* Wheels */}
      <g className={cls({ kind: 'pitch' }, 'cm-wheel')} onClick={choose({ kind: 'pitch' })}>
        <title>Pitch wheel: steers animation values through bindings in Properties</title>
        <rect x="10" y="14" width="13" height="56" rx="4" />
        <rect
          className="cm-wheel-mark"
          data-live="pitch:0"
          x="11"
          y="40"
          width="11"
          height="4"
          rx="1"
        />
      </g>
      <g className={cls({ kind: 'mod' }, 'cm-wheel')} onClick={choose({ kind: 'mod' })}>
        <title>{tip({ kind: 'mod' }, 'Mod wheel')}</title>
        <rect x="27" y="14" width="13" height="56" rx="4" />
        <rect
          className="cm-wheel-fill"
          data-live="mod:0"
          x="28"
          y="68"
          width="11"
          height="0"
          rx="1"
        />
      </g>
      <g className={cls({ kind: 'sustain' }, 'cm-sustain')} onClick={choose({ kind: 'sustain' })}>
        <title>{tip({ kind: 'sustain' }, 'Sustain pedal')}</title>
        <rect data-live="sustain:0" x="10" y="76" width="30" height="11" rx="3" />
        <text x="25" y="84">
          pedal
        </text>
      </g>

      {/* Pads: bottom row 1-4, top row 5-8 */}
      {Array.from({ length: 8 }, (_, i) => {
        const note = profile.padNotes[i] ?? 36 + i;
        const ref: ControlRef = { kind: 'pad', index: i, bank: 'A', note };
        const x = 50 + (i % 4) * 35;
        const y = i < 4 ? 46 : 14;
        return (
          <g key={i} className={cls(ref, 'cm-pad')} onClick={choose(ref)}>
            <title>{tip(ref, `Pad ${i + 1}`)}</title>
            <rect data-live={`pad:${i}`} x={x} y={y} width="31" height="28" rx="4" />
            <text x={x + 5} y={y + 11}>
              {i + 1}
            </text>
          </g>
        );
      })}

      {/* Knobs */}
      {Array.from({ length: 8 }, (_, i) => {
        const cc = profile.knobCCs[i] ?? 70 + i;
        const ref: ControlRef = { kind: 'knob', index: i, cc };
        const cx = 202 + (i % 4) * 30;
        const cy = 28 + Math.floor(i / 4) * 32;
        return (
          <g key={i} className={cls(ref, 'cm-knob')} onClick={choose(ref)}>
            <title>{tip(ref, `Knob ${i + 1} (CC ${cc})`)}</title>
            <circle cx={cx} cy={cy} r="11.5" />
            <g transform={`translate(${cx} ${cy})`}>
              <line data-live={`knob:${i}`} x1="0" y1="0" x2="0" y2="-9" transform="rotate(-135)" />
            </g>
          </g>
        );
      })}

      {/* Range mappings under the keys */}
      {ranges.map((r, i) => {
        const xs = [...whiteX.entries()]
          .filter(([n]) => n >= r.from && n <= r.to)
          .map(([, x]) => x);
        if (xs.length === 0) return null;
        const x0 = Math.min(...xs);
        const x1 = Math.max(...xs) + kw;
        return (
          <rect
            key={i}
            className="cm-range"
            x={x0}
            y={KEYS_Y + KEYS_H + 2}
            width={x1 - x0}
            height="3"
            rx="1.5"
          />
        );
      })}

      {/* Keys */}
      {whites.map((note, i) => {
        const ref: ControlRef = { kind: 'key', note };
        return (
          <g key={note} className={cls(ref, 'cm-key white')} onClick={choose(ref)}>
            <title>{tip(ref, noteName(note))}</title>
            <rect
              data-live={`key:${note}`}
              x={8 + i * kw + 0.5}
              y={KEYS_Y}
              width={kw - 1}
              height={KEYS_H}
              rx="2"
            />
            <circle className="cm-dot" cx={8 + i * kw + kw / 2} cy={KEYS_Y + KEYS_H - 8} r="2.6" />
            {note % 12 === 0 && (
              <text x={8 + i * kw + 3} y={KEYS_Y + KEYS_H - 16}>
                {noteName(note)}
              </text>
            )}
          </g>
        );
      })}
      {blacks.map((b) => {
        const ref: ControlRef = { kind: 'key', note: b.note };
        const x = 8 + b.afterWhite * kw - kw * 0.31;
        return (
          <g key={b.note} className={cls(ref, 'cm-key black')} onClick={choose(ref)}>
            <title>{tip(ref, noteName(b.note))}</title>
            <rect
              data-live={`key:${b.note}`}
              x={x}
              y={KEYS_Y}
              width={kw * 0.62}
              height={KEYS_H * 0.6}
              rx="2"
            />
            <circle className="cm-dot" cx={x + kw * 0.31} cy={KEYS_Y + KEYS_H * 0.6 - 7} r="2.4" />
          </g>
        );
      })}
    </svg>
  );
}
