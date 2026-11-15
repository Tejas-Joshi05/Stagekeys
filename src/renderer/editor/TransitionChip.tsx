import { useEffect, useRef } from 'react';
import {
  setEveryTransition,
  setSlideTransition,
  TRANSITION_GLYPH_NAMES,
  TRANSITION_KINDS,
  type Slide,
  type Transition,
} from '../deck';
import { isGlyphTransition, TRANSITION_HINTS, TRANSITION_LABELS } from '../presenter';
import { NumField, SelectField } from './fields';

/** A small picture of each transition, shown between the slides. */
export const TRANSITION_SYMBOLS: Record<Transition['kind'], string> = {
  cut: '│',
  fade: '◐',
  dip: '●',
  slide: '⇢',
  'slide-up': '⇡',
  cover: '⇥',
  zoom: '⤢',
  'ascii-dissolve': '░',
  'ascii-wipe': '▚',
  'ascii-scan': '▤',
  'ascii-rain': '⁞',
  'ascii-iris': '◎',
};

const seconds = (ms: number): string => `${(ms / 1000).toFixed(ms % 100 === 0 ? 1 : 2)} s`;

/** "Fade · 0.4 s", or just "Cut". */
export function transitionSummary(t: Transition): string {
  const name = TRANSITION_LABELS[t.kind];
  return t.kind === 'cut' || t.duration <= 0 ? name : `${name} · ${seconds(t.duration)}`;
}

interface Props {
  /** The slide this transition leads into. */
  slide: Slide;
  /** Its position, for the labels: the transition goes from `index` to `index + 1` (1-based). */
  index: number;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}

/**
 * The transition between two slides, drawn between their thumbnails. Click it
 * to change it in place. It belongs to the slide below it, so it moves with
 * that slide when slides are reordered.
 */
export function TransitionChip({ slide, index, open, onToggle, onClose }: Props) {
  const t = slide.transition;
  const box = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<Transition>): void => setSlideTransition(slide.id, patch);

  // Escape or a click elsewhere closes it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Element | null;
      if (!target || box.current?.contains(target)) return;
      // Another chip switches to itself on click. Closing here first would shift the list
      // under the pointer and the click would miss it.
      if (target.closest('.transition-chip')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown, true);
    };
  }, [open, onClose]);

  return (
    <div className={`transition-slot${open ? ' open' : ''}`} ref={box}>
      <button
        className={`transition-chip${t.kind === 'cut' ? ' cut' : ''}`}
        data-testid="transition-chip"
        aria-expanded={open}
        title={`How slide ${index + 1} arrives after slide ${index}. Click to change.`}
        onClick={onToggle}
      >
        <span className="transition-symbol" aria-hidden>
          {TRANSITION_SYMBOLS[t.kind]}
        </span>
        <span className="transition-name">{transitionSummary(t)}</span>
      </button>
      {open && (
        <div className="transition-editor" data-testid="transition-editor">
          <p className="transition-editor-title">
            Slide {index} → slide {index + 1}
          </p>
          <SelectField<Transition['kind']>
            label="Transition"
            testId="transition-kind"
            value={t.kind}
            options={TRANSITION_KINDS.map((kind) => ({
              value: kind,
              label: `${TRANSITION_SYMBOLS[kind]}  ${TRANSITION_LABELS[kind]}`,
            }))}
            onChange={(kind) => set({ kind })}
          />
          {t.kind !== 'cut' && (
            <NumField
              label="Duration (ms)"
              value={t.duration}
              min={0}
              max={5000}
              step={50}
              testId="transition-duration"
              onChange={(duration) => set({ duration })}
            />
          )}
          {isGlyphTransition(t.kind) && (
            <>
              <NumField
                label="Character size"
                value={t.cell}
                min={12}
                max={200}
                step={2}
                onChange={(cell) => set({ cell })}
              />
              <SelectField<Transition['glyphs']>
                label="Characters"
                value={t.glyphs}
                options={TRANSITION_GLYPH_NAMES.map((name) => ({ value: name, label: name }))}
                onChange={(glyphs) => set({ glyphs })}
              />
            </>
          )}
          <p className="hint transition-hint" data-testid="transition-hint">
            {TRANSITION_HINTS[t.kind]}
            {t.kind !== 'cut' && ' Going back plays it in reverse.'}
            {isGlyphTransition(t.kind) && ' Reads best at 600–900 ms.'}
          </p>
          <div className="transition-editor-foot">
            <button
              className="link"
              data-testid="transition-everywhere"
              title="Give every slide in the deck this transition"
              onClick={() => setEveryTransition(t)}
            >
              Use everywhere
            </button>
            <button className="link" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
